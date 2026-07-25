// Collecting a folder's worth of files from the browser.
//
// Three ways in, all giving every file a path relative to what the user
// picked, which is what src/gv/bundle.ts resolves into scenes:
//   - a drop, walked through the (non-standard but universally implemented)
//     webkitGetAsEntry directory API;
//   - a picker, via <input type="file" webkitdirectory> / multiple;
//   - a .zip among either of those, expanded here into the same list (see
//     expandZips) — the transport for anyone who cannot drag a directory.
// The first two read no file contents — File objects are lazy handles, so
// listing a 300 MB example folder costs nothing until a scene actually loads.

import { looksLikeZip, readZip } from './zip'

export interface PathedFile {
  /** Path relative to the dropped/selected root, forward-slashed. */
  path: string
  file: File
}

interface FileSystemEntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
  file?(cb: (f: File) => void, err: (e: unknown) => void): void
  createReader?(): {
    readEntries(cb: (entries: FileSystemEntryLike[]) => void, err: (e: unknown) => void): void
  }
}

/** Guard against a pathological drop (a home directory, say) hanging the tab. */
const MAX_FILES = 20000

function entryFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(null)
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    )
  })
}

/** readEntries returns at most ~100 per call; keep reading until it's empty. */
function readAllEntries(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader?.()
  if (!reader) return Promise.resolve([])
  const all: FileSystemEntryLike[] = []
  return new Promise((resolve) => {
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) return resolve(all)
          all.push(...batch)
          if (all.length >= MAX_FILES) return resolve(all)
          readBatch()
        },
        () => resolve(all),
      )
    }
    readBatch()
  })
}

async function walkEntry(
  entry: FileSystemEntryLike,
  prefix: string,
  out: PathedFile[],
): Promise<void> {
  if (out.length >= MAX_FILES) return
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
  if (entry.isFile) {
    const file = await entryFile(entry)
    if (file) out.push({ path, file })
    return
  }
  if (entry.isDirectory) {
    for (const child of await readAllEntries(entry)) {
      await walkEntry(child, path, out)
    }
  }
}

/**
 * Every file in a drop, folders walked recursively.
 *
 * Falls back to the flat `dataTransfer.files` list if the entry API is
 * unavailable — that loses folder structure, so a dropped folder yields
 * nothing, but a multi-file drop still works.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<PathedFile[]> {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === 'file')
  const entries = items
    .map((item) =>
      'webkitGetAsEntry' in item
        ? (item.webkitGetAsEntry() as unknown as FileSystemEntryLike | null)
        : null,
    )
    .filter((e): e is FileSystemEntryLike => e !== null)

  if (entries.length === 0) {
    return Array.from(dt.files ?? []).map((file) => ({ path: file.name, file }))
  }

  const out: PathedFile[] = []
  for (const entry of entries) await walkEntry(entry, '', out)
  return out
}

/**
 * Every file from a picker. `webkitdirectory` populates webkitRelativePath
 * (which includes the chosen folder's own name); a plain multi-select doesn't,
 * leaving bare file names — enough for bundle.ts, which treats those as one
 * flat folder.
 */
export function filesFromInput(input: HTMLInputElement): PathedFile[] {
  return Array.from(input.files ?? []).map((file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }))
}

/**
 * A Blob URL is what feeds `<video>` and `<audio>`, and those honour the
 * blob's MIME type rather than sniffing — an extracted video with an empty
 * type simply refuses to play. Zip entries carry no type, so it is restored
 * from the extension here, covering everything media.ts recognizes plus the
 * text formats. Anything else stays untyped, which is harmless.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  tga: 'image/x-tga',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
}

function mimeFor(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : (MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? '')
}

/** The path segment every entry in an archive shares, or '' if they don't. */
function commonTopFolder(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  const first = paths[0].split('/')
  if (first.length < 2) return ''
  const top = first[0]
  return paths.every((p) => p.startsWith(top + '/')) ? top : ''
}

/**
 * Replace every `.zip` in a file set with its contents, so an archive opens
 * exactly like the folder it was made from.
 *
 * Archivers disagree about whether to include the folder itself: "zip this
 * folder" usually writes `Scene/Scene_gv_node.csv`, while "zip these files"
 * writes them at the root. When there is no shared top folder the zip's own
 * name becomes one, so the scene picker labels the scene after the archive
 * rather than after a bare CSV filename — and a multi-scene archive keeps
 * its sub-scenes in the same relative shape either way.
 *
 * A zip that fails to open is reported and skipped; the rest of the drop
 * still loads.
 */
export async function expandZips(
  files: PathedFile[],
): Promise<{ files: PathedFile[]; warnings: string[] }> {
  if (!files.some((f) => looksLikeZip(f.file.name))) return { files, warnings: [] }

  const out: PathedFile[] = []
  const warnings: string[] = []
  for (const entry of files) {
    if (!looksLikeZip(entry.file.name)) {
      out.push(entry)
      continue
    }
    try {
      const { entries, warnings: zipWarnings } = await readZip(entry.file)
      for (const w of zipWarnings) warnings.push(`${entry.file.name} → ${w}`)
      const stem = entry.file.name.replace(/\.zip$/i, '')
      const prefix = commonTopFolder(entries.map((e) => e.path)) === '' ? stem + '/' : ''
      for (const zipped of entries) {
        const name = zipped.path.split('/').pop()!
        out.push({
          path: prefix + zipped.path,
          // A fresh ArrayBuffer per entry: File keeps a reference, and the
          // decompressor already handed us an exclusive one.
          file: new File([zipped.bytes as unknown as BlobPart], name, { type: mimeFor(name) }),
        })
      }
      if (entries.length === 0) warnings.push(`${entry.file.name} holds no files.`)
    } catch (err: unknown) {
      warnings.push(`${entry.file.name} could not be opened: ${String(err)}`)
    }
  }
  return { files: out, warnings }
}
