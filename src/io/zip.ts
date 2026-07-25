// Reading a .zip in the browser, with no dependency.
//
// A GlyphViz scene is a FOLDER (node CSV + companion gv_tag.csv + media/ +
// the Channels companions), and a zip is the obvious way to hand one to
// someone who cannot drag a directory — an email attachment, a download, a
// phone. Everything downstream already works off a flat list of relative
// paths (src/gv/bundle.ts), so a zip only has to be turned into that list;
// findScenes then resolves it exactly like a dropped folder.
//
// Written in-house rather than pulling a zip library, the same call the
// project made for its RFC 4180 CSV tokenizer: the platform already ships
// the hard part. `DecompressionStream('deflate-raw')` is the inflate, and
// Blob.slice gives random access, so only the central directory has to be
// read to list an archive — the bytes of an entry are fetched by range.
//
// Format read from the PKWARE APPNOTE (4.3.6 local header, 4.3.12 central
// directory, 4.3.16 end of central directory, 4.3.14/4.3.15 the Zip64
// records). Supported: stored (0) and deflated (8) entries, Zip64 sizes and
// offsets, archives whose entries carry a data descriptor (the central
// directory always holds the real sizes, which is what this reads).
// Refused with a clear message: encrypted entries and any other compression
// method — a scene that silently loses its media would be worse.

/** One file recovered from an archive. Directory records never appear. */
export interface ZipFileEntry {
  /** Path inside the archive, forward-slashed, no leading slash. */
  path: string
  bytes: Uint8Array
}

export interface ZipReadResult {
  entries: ZipFileEntry[]
  /** Per-entry problems that did not stop the rest of the archive loading. */
  warnings: string[]
}

const EOCD_SIG = 0x06054b50
const EOCD64_LOCATOR_SIG = 0x07064b50
const EOCD64_SIG = 0x06064b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

const EOCD_SIZE = 22
const EOCD64_LOCATOR_SIZE = 20
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
/** A zip comment is a uint16 length, so the EOCD is never deeper than this. */
const MAX_COMMENT = 0xffff

const METHOD_STORE = 0
const METHOD_DEFLATE = 8
/** General purpose bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001

/** Refuse absurd archives rather than letting a zip bomb take the tab down. */
export const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024
export const MAX_ENTRIES = 20000

const U32_MAX = 0xffffffff
const U16_MAX = 0xffff

/** By name alone — the only thing a drop hands us before reading anything. */
export function looksLikeZip(name: string): boolean {
  return name.toLowerCase().endsWith('.zip')
}

interface CentralEntry {
  path: string
  method: number
  flags: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

/**
 * Archiver litter that has no counterpart in a real folder and would
 * otherwise be taken for scene content: a macOS zip carries an entire
 * `__MACOSX/` shadow tree of AppleDouble `._name` files, and one of those
 * beside a node CSV would appear in the scene picker as a second, broken
 * scene. `.DS_Store` is dropped for the same reason it never matters.
 */
function isArchiveLitter(path: string): boolean {
  const parts = path.split('/')
  if (parts.includes('__MACOSX')) return true
  const name = parts[parts.length - 1]
  return name.startsWith('._') || name === '.DS_Store'
}

async function view(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer())
}

/** Locate the End Of Central Directory record, scanning back over a comment. */
async function findEocd(blob: Blob): Promise<{ dv: DataView; offset: number; base: number }> {
  const tailLength = Math.min(blob.size, EOCD_SIZE + MAX_COMMENT)
  const base = blob.size - tailLength
  const dv = await view(blob, base, blob.size)
  for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
    if (dv.getUint32(i, true) !== EOCD_SIG) continue
    // Guard against the signature appearing inside compressed data: the
    // comment length has to account for exactly the rest of the file.
    if (dv.getUint16(i + 20, true) === tailLength - i - EOCD_SIZE) {
      return { dv, offset: i, base }
    }
  }
  throw new Error('not a zip archive (no end-of-central-directory record)')
}

/** Central directory location, following the Zip64 records when present. */
async function centralDirectoryRange(
  blob: Blob,
): Promise<{ offset: number; size: number; count: number }> {
  const { dv, offset, base } = await findEocd(blob)
  let count = dv.getUint16(offset + 10, true)
  let size = dv.getUint32(offset + 12, true)
  let start = dv.getUint32(offset + 16, true)

  const needsZip64 = count === U16_MAX || size === U32_MAX || start === U32_MAX
  if (!needsZip64) return { offset: start, size, count }

  const locatorAt = base + offset - EOCD64_LOCATOR_SIZE
  if (locatorAt < 0) throw new Error('Zip64 archive is missing its locator record')
  const locator = await view(blob, locatorAt, locatorAt + EOCD64_LOCATOR_SIZE)
  if (locator.getUint32(0, true) !== EOCD64_LOCATOR_SIG) {
    throw new Error('Zip64 archive is missing its locator record')
  }
  const eocd64At = Number(locator.getBigUint64(8, true))
  const eocd64 = await view(blob, eocd64At, eocd64At + 56)
  if (eocd64.getUint32(0, true) !== EOCD64_SIG) {
    throw new Error('Zip64 end-of-central-directory record not found')
  }
  count = Number(eocd64.getBigUint64(32, true))
  size = Number(eocd64.getBigUint64(40, true))
  start = Number(eocd64.getBigUint64(48, true))
  return { offset: start, size, count }
}

/**
 * Zip64 extended information (header id 0x0001) supplies whichever of
 * uncompressed size / compressed size / local offset were written as the
 * 0xFFFFFFFF sentinel, in that fixed order.
 */
function readZip64Extra(dv: DataView, start: number, length: number, entry: CentralEntry): void {
  let at = start
  const end = start + length
  while (at + 4 <= end) {
    const id = dv.getUint16(at, true)
    const size = dv.getUint16(at + 2, true)
    let field = at + 4
    if (id === 0x0001) {
      if (entry.uncompressedSize === U32_MAX && field + 8 <= end) {
        entry.uncompressedSize = Number(dv.getBigUint64(field, true))
        field += 8
      }
      if (entry.compressedSize === U32_MAX && field + 8 <= end) {
        entry.compressedSize = Number(dv.getBigUint64(field, true))
        field += 8
      }
      if (entry.localOffset === U32_MAX && field + 8 <= end) {
        entry.localOffset = Number(dv.getBigUint64(field, true))
      }
      return
    }
    at = field + size
  }
}

/**
 * General purpose bit 11 promises UTF-8; without it the spec says CP437. Every
 * archiver in practical use writes UTF-8, or pure ASCII where the two agree,
 * and TextDecoder has no CP437 — so UTF-8 either way is the closer answer.
 */
function decodeName(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function readCentralDirectory(blob: Blob): Promise<CentralEntry[]> {
  const { offset, size, count } = await centralDirectoryRange(blob)
  if (count > MAX_ENTRIES) {
    throw new Error(`archive holds ${count} entries; the limit is ${MAX_ENTRIES}`)
  }
  const dv = await view(blob, offset, offset + size)
  const entries: CentralEntry[] = []
  let at = 0
  while (at + CENTRAL_HEADER_SIZE <= dv.byteLength) {
    if (dv.getUint32(at, true) !== CENTRAL_SIG) break
    const flags = dv.getUint16(at + 8, true)
    const nameLength = dv.getUint16(at + 28, true)
    const extraLength = dv.getUint16(at + 30, true)
    const commentLength = dv.getUint16(at + 32, true)
    const nameAt = at + CENTRAL_HEADER_SIZE
    const entry: CentralEntry = {
      path: decodeName(new Uint8Array(dv.buffer, dv.byteOffset + nameAt, nameLength)),
      method: dv.getUint16(at + 10, true),
      flags,
      compressedSize: dv.getUint32(at + 20, true),
      uncompressedSize: dv.getUint32(at + 24, true),
      localOffset: dv.getUint32(at + 42, true),
    }
    readZip64Extra(dv, nameAt + nameLength, extraLength, entry)
    entries.push(entry)
    at = nameAt + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflateRaw(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readEntryBytes(blob: Blob, entry: CentralEntry): Promise<Uint8Array> {
  const header = await view(blob, entry.localOffset, entry.localOffset + LOCAL_HEADER_SIZE)
  if (header.getUint32(0, true) !== LOCAL_SIG) {
    throw new Error('local file header not found')
  }
  // The local header's own name/extra lengths can differ from the central
  // directory's, so the data offset must come from here.
  const dataAt =
    entry.localOffset +
    LOCAL_HEADER_SIZE +
    header.getUint16(26, true) +
    header.getUint16(28, true)
  const data = await blob.slice(dataAt, dataAt + entry.compressedSize).arrayBuffer()
  if (entry.method === METHOD_STORE) return new Uint8Array(data)
  return inflateRaw(data)
}

/**
 * Every file in an archive, decompressed.
 *
 * Deliberately eager: the caller hands the results on as `File` objects, and
 * the rest of the app treats a file set as readable at any time. A dropped
 * FOLDER stays lazy (its `File`s are disk-backed handles) — a zip trades that
 * for holding the expanded scene in memory, which is why the total is capped.
 * Scene folders in the desktop corpus top out around 48 MB.
 */
export async function readZip(blob: Blob): Promise<ZipReadResult> {
  const warnings: string[] = []
  const central = await readCentralDirectory(blob)

  let total = 0
  const wanted: CentralEntry[] = []
  for (const entry of central) {
    if (entry.path.endsWith('/')) continue // directory record
    const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (path === '' || isArchiveLitter(path)) continue
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
      warnings.push(`${path}: entry is encrypted and was skipped.`)
      continue
    }
    if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) {
      warnings.push(
        `${path}: compression method ${entry.method} is not supported (only stored and ` +
          'deflated entries are) and was skipped.',
      )
      continue
    }
    total += entry.uncompressedSize
    wanted.push({ ...entry, path })
  }
  if (total > MAX_TOTAL_UNCOMPRESSED) {
    throw new Error(
      `archive expands to ${Math.round(total / 1e6)} MB; the limit is ` +
        `${Math.round(MAX_TOTAL_UNCOMPRESSED / 1e6)} MB`,
    )
  }

  const entries: ZipFileEntry[] = []
  for (const entry of wanted) {
    try {
      entries.push({ path: entry.path, bytes: await readEntryBytes(blob, entry) })
    } catch (err: unknown) {
      // One unreadable member must not cost the whole scene.
      warnings.push(`${entry.path}: could not be extracted (${String(err)}).`)
    }
  }
  return { entries, warnings }
}
