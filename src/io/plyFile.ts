// PLY — the Stanford polygon format, read for both of the things it holds.
//
// A PLY file is a vertex table plus an optional face table, which is why the
// same parser serves two importers here: the MESH importer wants the faces
// (gv/meshFile.ts), and the POINT-CLOUD importer wants the vertices and their
// colours (gv/pointCloudLoader.ts). The desktop gets both from trimesh, which
// it already depends on for .obj/.stl; this app parses .obj and .stl itself, so
// PLY is the third in-house reader rather than the one place a dependency would
// have been needed.
//
// Two element tables, three encodings (ascii, binary_little_endian,
// binary_big_endian) and a list property for the faces is the whole format.
// Everything past that — custom elements, other list properties, comments — is
// SKIPPED by walking its declared width, which is what makes an unfamiliar
// producer's file still open.
//
// Pure data: no DOM, no THREE.

export class PlyError extends Error {}

/** Scalar property types, and how many bytes each takes in a binary file. */
const TYPE_SIZES: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
}

interface PlyProperty {
  name: string
  type: string
  /** For a list property, the type of its leading count. */
  countType: string | null
}

interface PlyElement {
  name: string
  count: number
  properties: PlyProperty[]
}

export interface PlyData {
  /** (V·3) vertex positions in the file's own units. */
  positions: Float64Array
  /** (V·3) vertex colours, when the file carries them. */
  colors: Uint8Array | null
  /** (T·3) triangle indices, when the file carries faces. */
  indices: Uint32Array | null
  vertexCount: number
}

/**
 * Colour property names, in the order a file is searched for them.
 *
 * `red/green/blue` is the convention; `diffuse_red/…` is what several older
 * scanners and MeshLab write, and `r/g/b` turns up in hand-rolled exports.
 * trimesh accepts the same three sets, so a file the desktop colours is a file
 * this colours.
 */
const COLOR_NAME_SETS = [
  ['red', 'green', 'blue'],
  ['diffuse_red', 'diffuse_green', 'diffuse_blue'],
  ['r', 'g', 'b'],
]

/**
 * Split the header off the front of the file.
 *
 * The header is always ASCII and always ends with `end_header\n`, whatever
 * encoding the body uses — so it is found by scanning bytes rather than by
 * decoding the whole file, which would fail outright on a binary body.
 */
function splitHeader(bytes: Uint8Array): { lines: string[]; bodyAt: number } {
  const needle = 'end_header'
  const limit = Math.min(bytes.length, 1 << 20)
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, limit))
  const at = text.indexOf(needle)
  if (at === -1) throw new PlyError('Not a PLY file: no end_header line.')
  let bodyAt = at + needle.length
  // Step over the line ending, which may be \n or \r\n.
  if (bytes[bodyAt] === 0x0d) bodyAt++
  if (bytes[bodyAt] === 0x0a) bodyAt++
  return {
    lines: text
      .slice(0, at)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== ''),
    bodyAt,
  }
}

function parseHeader(lines: string[]): { format: string; elements: PlyElement[] } {
  if (lines[0]?.toLowerCase() !== 'ply') throw new PlyError('Not a PLY file: missing magic line.')
  let format = ''
  const elements: PlyElement[] = []
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/)
    const keyword = parts[0].toLowerCase()
    if (keyword === 'format') {
      format = parts[1]?.toLowerCase() ?? ''
    } else if (keyword === 'element') {
      elements.push({ name: parts[1], count: Number(parts[2]), properties: [] })
    } else if (keyword === 'property') {
      const element = elements[elements.length - 1]
      if (!element) continue
      if (parts[1]?.toLowerCase() === 'list') {
        element.properties.push({ name: parts[4], type: parts[3], countType: parts[2] })
      } else {
        element.properties.push({ name: parts[2], type: parts[1], countType: null })
      }
    }
  }
  if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format)) {
    throw new PlyError(`Unsupported PLY format ${format || '(none declared)'}.`)
  }
  return { format, elements }
}

/** Which of a vertex element's properties hold position and colour. */
function vertexLayout(element: PlyElement): { xyz: number[]; rgb: number[] | null } {
  const index = (name: string): number =>
    element.properties.findIndex((p) => p.name.toLowerCase() === name)
  const xyz = ['x', 'y', 'z'].map(index)
  if (xyz.some((i) => i < 0)) throw new PlyError('PLY vertex element has no x/y/z properties.')
  for (const names of COLOR_NAME_SETS) {
    const rgb = names.map(index)
    if (rgb.every((i) => i >= 0)) return { xyz, rgb }
  }
  return { xyz, rgb: null }
}

/**
 * Colour values scaled to bytes.
 *
 * A float-typed colour property is 0..1 by convention and an integer one is
 * already 0..255 — the same split trimesh makes, and getting it wrong turns a
 * float-coloured cloud black rather than merely off-hue.
 */
function colorByte(value: number, type: string): number {
  const scaled = type === 'float' || type === 'float32' || type === 'double' || type === 'float64'
    ? value * 255
    : value
  return Math.max(0, Math.min(255, Math.round(scaled)))
}

function readScalar(view: DataView, at: number, type: string, little: boolean): number {
  switch (type) {
    case 'char':
    case 'int8':
      return view.getInt8(at)
    case 'uchar':
    case 'uint8':
      return view.getUint8(at)
    case 'short':
    case 'int16':
      return view.getInt16(at, little)
    case 'ushort':
    case 'uint16':
      return view.getUint16(at, little)
    case 'int':
    case 'int32':
      return view.getInt32(at, little)
    case 'uint':
    case 'uint32':
      return view.getUint32(at, little)
    case 'float':
    case 'float32':
      return view.getFloat32(at, little)
    case 'double':
    case 'float64':
      return view.getFloat64(at, little)
    default:
      throw new PlyError(`Unsupported PLY property type '${type}'.`)
  }
}

function sizeOf(type: string): number {
  const size = TYPE_SIZES[type]
  if (size === undefined) throw new PlyError(`Unsupported PLY property type '${type}'.`)
  return size
}

/** A polygon's vertex indices as a triangle fan — trimesh's own triangulation. */
function fan(poly: number[], out: number[]): void {
  for (let i = 2; i < poly.length; i++) out.push(poly[0], poly[i - 1], poly[i])
}

/**
 * Parse a PLY file into vertices, optional colours and optional triangles.
 *
 * Faces are triangulated as fans, which is what trimesh does for the quad-mesh
 * PLYs that turn up from scanning software.
 */
export function parsePlyFile(bytes: Uint8Array): PlyData {
  const { lines, bodyAt } = splitHeader(bytes)
  const { format, elements } = parseHeader(lines)
  const vertexElement = elements.find((e) => e.name.toLowerCase() === 'vertex')
  if (!vertexElement || vertexElement.count === 0) {
    throw new PlyError('PLY file holds no vertices.')
  }
  const layout = vertexLayout(vertexElement)

  const positions = new Float64Array(vertexElement.count * 3)
  const colors = layout.rgb ? new Uint8Array(vertexElement.count * 3) : null
  const faces: number[] = []

  if (format === 'ascii') {
    parseAscii(bytes, bodyAt, elements, vertexElement, layout, positions, colors, faces)
  } else {
    parseBinary(
      bytes,
      bodyAt,
      format === 'binary_little_endian',
      elements,
      vertexElement,
      layout,
      positions,
      colors,
      faces,
    )
  }

  return {
    positions,
    colors,
    indices: faces.length > 0 ? Uint32Array.from(faces) : null,
    vertexCount: vertexElement.count,
  }
}

function parseAscii(
  bytes: Uint8Array,
  bodyAt: number,
  elements: PlyElement[],
  vertexElement: PlyElement,
  layout: { xyz: number[]; rgb: number[] | null },
  positions: Float64Array,
  colors: Uint8Array | null,
  faces: number[],
): void {
  const text = new TextDecoder('latin1').decode(bytes.subarray(bodyAt))
  const rows = text.split(/\r?\n/)
  let row = 0
  const nextRow = (): number[] => {
    while (row < rows.length) {
      const line = rows[row++].trim()
      if (line !== '' && !line.startsWith('comment')) {
        return line.split(/\s+/).map(Number)
      }
    }
    throw new PlyError('PLY file ended before its declared elements did.')
  }

  for (const element of elements) {
    const isVertex = element === vertexElement
    const isFace = element.name.toLowerCase() === 'face'
    for (let i = 0; i < element.count; i++) {
      const values = nextRow()
      if (isVertex) {
        for (let a = 0; a < 3; a++) positions[i * 3 + a] = values[layout.xyz[a]]
        if (colors && layout.rgb) {
          for (let a = 0; a < 3; a++) {
            const p = element.properties[layout.rgb[a]]
            colors[i * 3 + a] = colorByte(values[layout.rgb[a]], p.type)
          }
        }
      } else if (isFace && values.length >= 4) {
        // The first list property of a face element is its vertex index list;
        // its leading value is the count, so the polygon is what follows.
        fan(values.slice(1, 1 + values[0]), faces)
      }
    }
  }
}

function parseBinary(
  bytes: Uint8Array,
  bodyAt: number,
  little: boolean,
  elements: PlyElement[],
  vertexElement: PlyElement,
  layout: { xyz: number[]; rgb: number[] | null },
  positions: Float64Array,
  colors: Uint8Array | null,
  faces: number[],
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = bodyAt

  for (const element of elements) {
    const isVertex = element === vertexElement
    const isFace = element.name.toLowerCase() === 'face'
    // A vertex element is fixed-stride, so its property offsets are computed
    // once rather than per row — the difference between a couple of hundred
    // milliseconds and several seconds on a million-vertex scan.
    const offsets: number[] = []
    let stride = 0
    const fixed = element.properties.every((p) => p.countType === null)
    if (fixed) {
      for (const p of element.properties) {
        offsets.push(stride)
        stride += sizeOf(p.type)
      }
    }

    for (let i = 0; i < element.count; i++) {
      if (fixed) {
        if (at + stride > bytes.length) throw new PlyError('PLY file ends mid-element.')
        if (isVertex) {
          for (let a = 0; a < 3; a++) {
            const p = element.properties[layout.xyz[a]]
            positions[i * 3 + a] = readScalar(view, at + offsets[layout.xyz[a]], p.type, little)
          }
          if (colors && layout.rgb) {
            for (let a = 0; a < 3; a++) {
              const p = element.properties[layout.rgb[a]]
              const raw = readScalar(view, at + offsets[layout.rgb[a]], p.type, little)
              colors[i * 3 + a] = colorByte(raw, p.type)
            }
          }
        }
        at += stride
        continue
      }

      // A row carrying a list property has to be walked property by property.
      const poly: number[] = []
      for (const p of element.properties) {
        if (p.countType === null) {
          at += sizeOf(p.type)
          continue
        }
        const n = readScalar(view, at, p.countType, little)
        at += sizeOf(p.countType)
        const width = sizeOf(p.type)
        const wanted = isFace && poly.length === 0
        for (let k = 0; k < n; k++) {
          if (wanted) poly.push(readScalar(view, at, p.type, little))
          at += width
        }
      }
      if (isFace && poly.length >= 3) fan(poly, faces)
    }
  }
}
