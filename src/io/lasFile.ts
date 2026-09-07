// LAS / LAZ — the binary reader behind point-cloud import (gv/pointCloudLoader).
//
// LAS is not a proprietary format: it is a published ASPRS specification (1.0
// through 1.4), and LAZ is its lossless compressed form, an OGC Community
// Standard since September 2026. The desktop reads both through `laspy` with
// the `lazrs` codec; this app reads the CONTAINER itself — public header block,
// VLR directory, point records — and delegates only the arithmetic
// decompression, which is the one part nobody should write twice.
//
// The split is what keeps the dependency small and optional. A `.las` needs no
// decoder at all: its point records are already the bytes we want, so the file
// is a header parse and a subarray. A `.laz` differs only in that those same
// records arrive through @voxelkloud/wasm-codecs (a wasm build of laz-rs), and
// the import is DYNAMIC, so a session that never opens a LAZ never fetches the
// 147 KB module.
//
// Everything here reads a plain Uint8Array. No DOM, no THREE — the whole reader
// is exercisable in plain node, and a File's bytes are the caller's problem.

/** Extensions this module reads. */
export const LAS_EXTENSIONS = ['.las', '.laz'] as const

/** "LASF", the signature every LAS/LAZ file opens with. */
const SIGNATURE = 0x4c415346

/**
 * Size of one point record for LAS point data record formats 0–10, from the
 * spec's own tables. A file may declare a LARGER record (extra bytes after the
 * standard fields — the desktop's own LIDAR example does, at 40 bytes for a
 * 26-byte format 2), which is legal and changes nothing about the offsets
 * below; a SMALLER one is malformed.
 */
const FORMAT_SIZES = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67]

/**
 * Byte offset of the RGB triple within a record, or −1 for a format with no
 * colour. Formats 2/3/5 carry it after the legacy core; 7/8/10 after the 1.4
 * core, which is two bytes longer and moves the GPS time into every record.
 */
const RGB_OFFSETS = [-1, -1, 20, 28, -1, 28, -1, 30, 30, -1, 30]

/**
 * Classification lives at byte 15 in the legacy formats (0–5) as the low FIVE
 * bits of a byte it shares with the synthetic / key-point / withheld flags, and
 * at byte 16 in the 1.4 formats (6–10) as a full byte of its own.
 *
 * The mask is not cosmetic. A legacy file that marks points withheld sets bit
 * 7, so an unmasked read of a class-2 ground point comes back as 130 — which
 * would miss the ASPRS table, be coloured as a user class, and drop out of a
 * "keep ground" filter. laspy exposes the same 5-bit sub-field (its dimension
 * list carries `synthetic`, `key_point` and `withheld` separately), so this is
 * the value the desktop filters and colours by.
 */
function classificationAt(format: number): { offset: number; mask: number } {
  return format >= 6 ? { offset: 16, mask: 0xff } : { offset: 15, mask: 0x1f }
}

export interface LasVlr {
  userId: string
  recordId: number
  description: string
  data: Uint8Array
}

export interface LasHeaderInfo {
  /** "1.2", "1.4", … */
  version: string
  /** Point data record format 0–10, with the laszip compression bits masked off. */
  pointFormat: number
  /** Declared record length, which may exceed the format's own size. */
  pointSize: number
  pointCount: number
  scale: [number, number, number]
  offset: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  offsetToPointData: number
  /** True when the format's high bits say the records are laszip-compressed. */
  compressed: boolean
  hasRgb: boolean
  hasIntensity: boolean
  hasClassification: boolean
  /** Coordinate reference system name, when the file carries one as WKT. */
  crs: string
  vlrs: LasVlr[]
}

export class LasError extends Error {}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    const c = bytes[start + i]
    if (c === 0) break
    out += String.fromCharCode(c)
  }
  return out.trim()
}

/**
 * Parse the public header block and the VLR directory.
 *
 * Works identically on a `.las` and a `.laz` — the header of a compressed file
 * is written uncompressed, which is what makes a scan cheap however large the
 * file is. Only the point records past `offsetToPointData` differ.
 */
export function readLasHeader(bytes: Uint8Array): LasHeaderInfo {
  if (bytes.length < 227) throw new LasError('Not a LAS/LAZ file: too short to hold a header.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, false) !== SIGNATURE) {
    throw new LasError('Not a LAS/LAZ file: the LASF signature is missing.')
  }

  const major = view.getUint8(24)
  const minor = view.getUint8(25)
  const headerSize = view.getUint16(94, true)
  const offsetToPointData = view.getUint32(96, true)
  const vlrCount = view.getUint32(100, true)
  const rawFormat = view.getUint8(104)
  const pointSize = view.getUint16(105, true)
  let pointCount = view.getUint32(107, true)

  // laszip sets the top bits of the format byte rather than adding a field, so
  // a LAZ announces itself here and nowhere else in the public header.
  const compressed = (rawFormat & 0xc0) !== 0
  const pointFormat = rawFormat & 0x3f
  if (pointFormat >= FORMAT_SIZES.length) {
    throw new LasError(`Unsupported LAS point data record format ${pointFormat}.`)
  }
  if (pointSize < FORMAT_SIZES[pointFormat]) {
    throw new LasError(
      `Malformed LAS: format ${pointFormat} needs ${FORMAT_SIZES[pointFormat]} bytes per point, ` +
        `the header declares ${pointSize}.`,
    )
  }

  // 1.4 widened the count to 64 bits and left the legacy field as a fallback
  // that a file with more than 2^32 points is required to zero.
  if ((major > 1 || (major === 1 && minor >= 4)) && bytes.length >= 255) {
    const wide = Number(view.getBigUint64(247, true))
    if (wide > 0) pointCount = wide
  }

  const f64 = (o: number): number => view.getFloat64(o, true)
  const scale: [number, number, number] = [f64(131), f64(139), f64(147)]
  const offset: [number, number, number] = [f64(155), f64(163), f64(171)]
  // The header stores each axis as max-then-min, interleaved x, y, z.
  const max: [number, number, number] = [f64(179), f64(195), f64(211)]
  const min: [number, number, number] = [f64(187), f64(203), f64(219)]

  const vlrs = readVlrs(bytes, headerSize, vlrCount, offsetToPointData)
  return {
    version: `${major}.${minor}`,
    pointFormat,
    pointSize,
    pointCount,
    scale,
    offset,
    min,
    max,
    offsetToPointData,
    compressed,
    hasRgb: RGB_OFFSETS[pointFormat] >= 0,
    // Every LAS point format carries both, which is exactly why a column being
    // PRESENT says nothing about whether it holds anything (see
    // `isReallyClassified` in gv/pointCloudLoader.ts).
    hasIntensity: true,
    hasClassification: true,
    crs: readCrsName(vlrs),
    vlrs,
  }
}

/** The VLR directory, stopping cleanly at the end of the buffer. */
function readVlrs(bytes: Uint8Array, start: number, count: number, limit: number): LasVlr[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: LasVlr[] = []
  let at = start
  const end = Math.min(limit || bytes.length, bytes.length)
  for (let i = 0; i < count; i++) {
    if (at + 54 > end) break
    const userId = ascii(bytes, at + 2, 16)
    const recordId = view.getUint16(at + 18, true)
    const length = view.getUint16(at + 20, true)
    const description = ascii(bytes, at + 22, 32)
    if (at + 54 + length > end) break
    out.push({ userId, recordId, description, data: bytes.subarray(at + 54, at + 54 + length) })
    at += 54 + length
  }
  return out
}

/**
 * The CRS's human name, read out of the OGC WKT VLR when the file carries one.
 *
 * A display nicety, reported and never used for geometry — which is why it is
 * pulled out of the WKT's first quoted name rather than parsed. GeoTIFF-keyed
 * files (the older convention) are left blank rather than guessed at.
 *
 * Divergence, in this app's favour: the desktop calls `laspy.header.parse_crs`,
 * which needs `pyproj` — an OPTIONAL laspy extra the project does not depend on
 * — so on a stock install it reports nothing at all. It is wrapped in a
 * try/except there for the same reason it is best-effort here: the geometry is
 * already in hand and a CRS must never fail an import.
 */
function readCrsName(vlrs: readonly LasVlr[]): string {
  const wkt = vlrs.find((v) => v.recordId === 2112 && v.userId.startsWith('LASF_Projection'))
  if (!wkt) return ''
  const text = new TextDecoder().decode(wkt.data)
  const quoted = /"([^"]+)"/.exec(text)
  return quoted ? quoted[1] : ''
}

/**
 * The file's point records, decompressed if need be.
 *
 * A `.las` returns a view straight into the caller's bytes — no copy, no
 * decoder. A `.laz` goes through the wasm codec, which is imported HERE, at
 * first use: a session that opens only uncompressed files never fetches it.
 *
 * `wasmSource` overrides where the codec finds its `.wasm`, which the package
 * otherwise resolves next to its own module (a `new URL(…, import.meta.url)`
 * Vite rewrites at build time, and node reads off disk). It exists for a host
 * that wants to preload or pin the binary; nothing in this app passes it.
 */
export async function readLasRecords(
  bytes: Uint8Array,
  header: LasHeaderInfo,
  wasmSource?: BufferSource | URL | string,
): Promise<Uint8Array> {
  if (!header.compressed) {
    const start = header.offsetToPointData
    const end = start + header.pointCount * header.pointSize
    if (end > bytes.length) {
      const held = Math.max(0, Math.floor((bytes.length - start) / header.pointSize))
      throw new LasError(
        `Truncated LAS: the header promises ${header.pointCount.toLocaleString()} points, ` +
          `the file holds ${held.toLocaleString()}.`,
      )
    }
    return bytes.subarray(start, end)
  }

  let codec: typeof import('@voxelkloud/wasm-codecs')
  try {
    codec = await import('@voxelkloud/wasm-codecs')
  } catch (err: unknown) {
    throw new LasError(
      'This is a compressed LAZ file and the LAZ decoder could not be loaded ' +
        `(${String(err)}). Save it as an uncompressed .las and try again.`,
    )
  }
  await codec.initLazCodec(wasmSource)
  const decoded = codec.decodeLazFile(bytes)
  try {
    return decoded.points
  } finally {
    // The records are copied out of wasm memory by that getter, so the
    // decoder's own buffer — 400 MB on a ten-million-point tile — can go back
    // immediately rather than at the next GC.
    decoded.free()
  }
}

/** Everything a caller needs to read fields out of one opened file. */
export interface LasFile {
  header: LasHeaderInfo
  records: Uint8Array
  recordSize: number
}

/** Header + records in one call, the shape `gv/pointCloudLoader` consumes. */
export async function openLasFile(
  bytes: Uint8Array,
  wasmSource?: BufferSource | URL | string,
): Promise<LasFile> {
  const header = readLasHeader(bytes)
  const records = await readLasRecords(bytes, header, wasmSource)
  return { header, records, recordSize: header.pointSize }
}

function recordView(file: LasFile): DataView {
  return new DataView(file.records.buffer, file.records.byteOffset, file.records.byteLength)
}

/**
 * Real-world xyz for the given record indices, as N×3 float64.
 *
 * LAS stores each coordinate as a scaled 32-bit integer plus a per-file offset,
 * so this multiply IS the file's geometry — skipping it hands back raw integers
 * in the hundreds of millions. Double precision throughout, because a
 * georeferenced easting near 700,000 needs more mantissa than a float32 has
 * before the fit recentres it.
 */
export function lasXyz(file: LasFile, keep: Int32Array | readonly number[]): Float64Array {
  const view = recordView(file)
  const { scale, offset } = file.header
  const size = file.recordSize
  const out = new Float64Array(keep.length * 3)
  for (let i = 0; i < keep.length; i++) {
    const at = keep[i] * size
    out[i * 3] = view.getInt32(at, true) * scale[0] + offset[0]
    out[i * 3 + 1] = view.getInt32(at + 4, true) * scale[1] + offset[1]
    out[i * 3 + 2] = view.getInt32(at + 8, true) * scale[2] + offset[2]
  }
  return out
}

/**
 * The raw 16-bit RGB triples, or null for a format with no colour fields.
 *
 * Deliberately NOT scaled to 8 bits here: whether a file's values are genuinely
 * 16-bit is decided from the data, and that decision belongs with the rest of
 * the colour rules (`resolveColors`), not in the byte reader.
 */
export function lasRgb(file: LasFile, keep: Int32Array | readonly number[]): Uint16Array | null {
  const rgbAt = RGB_OFFSETS[file.header.pointFormat]
  if (rgbAt < 0) return null
  const view = recordView(file)
  const size = file.recordSize
  const out = new Uint16Array(keep.length * 3)
  for (let i = 0; i < keep.length; i++) {
    const at = keep[i] * size + rgbAt
    out[i * 3] = view.getUint16(at, true)
    out[i * 3 + 1] = view.getUint16(at + 2, true)
    out[i * 3 + 2] = view.getUint16(at + 4, true)
  }
  return out
}

/**
 * True as soon as any point carries a non-zero colour channel.
 *
 * A colour column that is entirely zero is not colour, and a scan that reported
 * it as such would send the importer's Automatic mode down the RGB branch to a
 * black cloud. The desktop reaches the same conclusion from its 200,000-point
 * sample (`scan_file`'s `if sample.colors is None`); this walks the records with
 * an early exit, so a coloured file answers on point one and only an uncoloured
 * one pays for the whole table.
 */
export function lasHasAnyColor(file: LasFile): boolean {
  const rgbAt = RGB_OFFSETS[file.header.pointFormat]
  if (rgbAt < 0) return false
  const size = file.recordSize
  const records = file.records
  const n = Math.floor(records.length / size)
  for (let i = 0; i < n; i++) {
    const at = i * size + rgbAt
    // Any non-zero BYTE of the six is a non-zero channel; there is no need to
    // reassemble the 16-bit values to answer this question.
    for (let b = 0; b < 6; b++) if (records[at + b] !== 0) return true
  }
  return false
}

/** ASPRS classification codes — see `classificationAt` for the 5-bit mask. */
export function lasClassification(file: LasFile, keep: Int32Array | readonly number[]): Uint8Array {
  const { offset: at, mask } = classificationAt(file.header.pointFormat)
  const size = file.recordSize
  const records = file.records
  const out = new Uint8Array(keep.length)
  for (let i = 0; i < keep.length; i++) out[i] = records[keep[i] * size + at] & mask
  return out
}

/** Return intensity, at byte 12 of every point data record format. */
export function lasIntensity(file: LasFile, keep: Int32Array | readonly number[]): Uint16Array {
  const view = recordView(file)
  const size = file.recordSize
  const out = new Uint16Array(keep.length)
  for (let i = 0; i < keep.length; i++) out[i] = view.getUint16(keep[i] * size + 12, true)
  return out
}

/**
 * Every point's classification, without materializing anything else.
 *
 * What the import window's class list is built from, and what the class filter
 * narrows before a single coordinate is read — the ordering the desktop's
 * `_read_las` exists to get right (see `loadPointCloud`).
 */
export function lasAllClassifications(file: LasFile): Uint8Array {
  const { offset: at, mask } = classificationAt(file.header.pointFormat)
  const size = file.recordSize
  const records = file.records
  const n = Math.floor(records.length / size)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = records[i * size + at] & mask
  return out
}
