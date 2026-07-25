// Collecting a folder's worth of files from the browser.
//
// Two ways in, both giving every file a path relative to what the user picked,
// which is what src/gv/bundle.ts resolves into scenes:
//   - a drop, walked through the (non-standard but universally implemented)
//     webkitGetAsEntry directory API;
//   - a picker, via <input type="file" webkitdirectory> / multiple.
// Neither reads file contents — File objects are lazy handles, so listing a
// 300 MB example folder costs nothing until a scene actually loads.

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
