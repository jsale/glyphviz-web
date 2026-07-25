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

/** One entry of the inspector's texture menu. */
export interface TextureChoice {
  id: number
  /** Menu text: `3 · clip.mp4 — video`. */
  label: string
}

/**
 * The texture_id menu for a scene: "None" plus every file in the media folder,
 * in id order.
 *
 * `current` is kept as its own entry when the folder never supplied it — a
 * scene authored against a media folder the browser wasn't given still shows
 * (and preserves) the id its CSV carries, rather than silently reading as
 * "None" and being overwritten by the first step.
 */
export function textureChoices(index: MediaIndex | null, current: number): TextureChoice[] {
  const choices: TextureChoice[] = [{ id: 0, label: 'None (0)' }]
  for (const entry of index?.entries ?? []) {
    const note =
      entry.support === 'unsupported'
        ? ' — no decoder'
        : entry.kind === 'video'
          ? ' — video'
          : ''
    choices.push({ id: entry.textureId, label: `${entry.textureId} · ${entry.name}${note}` })
  }
  if (current > 0 && !choices.some((c) => c.id === current)) {
    choices.push({ id: current, label: `${current} · (not in media folder)` })
    choices.sort((a, b) => a.id - b.id)
  }
  return choices
}

/**
 * Step to the next/previous texture in the menu, wrapping — the same
 * round-robin feel as the J/O attribute cycling keys. An id that isn't in the
 * menu at all (no media loaded) steps to the first entry.
 */
export function stepTextureId(
  choices: readonly TextureChoice[],
  current: number,
  direction: 1 | -1,
): number {
  if (choices.length === 0) return current
  const at = choices.findIndex((c) => c.id === current)
  if (at === -1) return choices[0].id
  return choices[(at + direction + choices.length) % choices.length].id
}
