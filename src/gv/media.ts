// texture_id ↔ media-file mapping.
//
// Authoritative spec: glyphviz repo, glyphviz-skill/references/textures-and-media.md,
// cross-checked against glyphviz_gl/texture_manager.py (load_folder) and
// video_manager.py (load_folder's first_id).
//
// There is no per-node file path in the CSV: `texture_id` is a 1-based index
// into the alphanumerically sorted contents of the scene's `media/` folder —
// images first (1..N), then videos continuing the numbering (N+1..). Ids are
// assigned by sorted position, so a file we cannot decode still consumes its
// id rather than shifting the ones after it.

/** Extensions the desktop treats as still/animated images, in id group 1. */
export const IMAGE_EXTS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.jfif',
  '.bmp',
  '.tga',
  '.gif',
  '.tif',
  '.tiff',
  '.webp',
] as const

/** Extensions the desktop treats as videos, numbered after every image. */
export const VIDEO_EXTS = [
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.webm',
  '.m4v',
  '.wmv',
  '.flv',
] as const

export type MediaKind = 'image' | 'video'

/**
 * How this browser can get at the file:
 * - `native` — decodable by the platform (an `<img>`/`<video>` source).
 * - `addon` — needs a Three.js loader (TGA).
 * - `unsupported` — no practical browser decoder; the id is still reserved.
 */
export type MediaSupport = 'native' | 'addon' | 'unsupported'

export interface MediaEntry {
  /** 1-based texture_id this file answers to. */
  textureId: number
  /** File name as it appears in the media folder. */
  name: string
  kind: MediaKind
  support: MediaSupport
}

export interface MediaIndex {
  entries: MediaEntry[]
  byTextureId: Map<number, MediaEntry>
  /** Files in the folder that are neither image nor video (e.g. Channels .wav). */
  ignored: string[]
}

const NON_NATIVE: Record<string, MediaSupport> = {
  '.tga': 'addon',
  '.tif': 'unsupported',
  '.tiff': 'unsupported',
  '.avi': 'unsupported',
  '.mkv': 'unsupported',
  '.wmv': 'unsupported',
  '.flv': 'unsupported',
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/**
 * Sort order for media file names.
 *
 * Case-insensitive, with a code-point tiebreak for stability. The desktop's
 * `sorted(Path…)` is case-INsensitive on Windows (PurePath normcase) and
 * case-SENSITIVE on Linux, so a mixed-case media folder can get different
 * texture_ids per platform there. Jeff's call (2026-07-25): match Windows,
 * where the examples were authored. Never `localeCompare` — its collation
 * reorders punctuation like `_` relative to letters, which Python's does not.
 */
export function compareMediaNames(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la !== lb) return la < lb ? -1 : 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Assign texture_ids to a media folder's file names.
 *
 * Deliberate divergence: the desktop bases the first video id on the number of
 * images that *successfully uploaded*, so one corrupt image silently shifts
 * every video id down by one. Here the base is the image *file* count, which
 * keeps ids independent of decode success. The two agree whenever every image
 * loads — i.e. always, in practice.
 */
export function buildMediaIndex(names: readonly string[]): MediaIndex {
  const images: string[] = []
  const videos: string[] = []
  const ignored: string[] = []
  for (const name of names) {
    const ext = extensionOf(name)
    if ((IMAGE_EXTS as readonly string[]).includes(ext)) images.push(name)
    else if ((VIDEO_EXTS as readonly string[]).includes(ext)) videos.push(name)
    else ignored.push(name)
  }
  images.sort(compareMediaNames)
  videos.sort(compareMediaNames)
  ignored.sort(compareMediaNames)

  const entries: MediaEntry[] = []
  const push = (name: string, kind: MediaKind) => {
    entries.push({
      textureId: entries.length + 1,
      name,
      kind,
      support: NON_NATIVE[extensionOf(name)] ?? 'native',
    })
  }
  for (const name of images) push(name, 'image')
  for (const name of videos) push(name, 'video')

  return {
    entries,
    byTextureId: new Map(entries.map((e) => [e.textureId, e])),
    ignored,
  }
}
