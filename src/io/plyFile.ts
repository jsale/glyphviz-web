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
  /**
   * (V·2) per-VERTEX texture coordinates, when the file carries them as vertex
   * properties. See UV_NAME_SETS.
   */
  uvs: Float32Array | null
  /**
   * (T·3·2) per-CORNER texture coordinates, when the file carries them on the
   * FACE element instead — PLY's other, equally common convention.
   *
   * Never set at the same time as `uvs`: a file is read one way or the other,
   * face coordinates winning, which is trimesh's own precedence.
   */
  cornerUvs: Float32Array | null
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
 * Texture-coordinate property names, in the order a vertex element is searched.
 *
 * PLY never standardised these, which is why there are three spellings and why
 * the order matters: the list and its precedence are trimesh's own
 * `texcoord_names`, so a PLY the desktop textures is a PLY this textures.
 */
const UV_NAME_SETS = [
  ['texture_u', 'texture_v'],
  ['u', 'v'],
  ['s', 't'],
]

/**
 * The face-element list property holding per-corner UVs.
 *
 * This is the convention MeshLab and most photogrammetry tools write, and it
 * is checked BEFORE the vertex properties above, again matching trimesh. Two
 * corners at one position may then carry different coordinates — that is a UV
 * seam, and gv/meshFile.ts is where those get split back apart.
 */
const FACE_UV_PROPERTY = 'texcoord'

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

/** Which of a vertex element's properties hold position, colour and UVs. */
interface VertexLayout {
  xyz: number[]
  rgb: number[] | null
  uv: number[] | null
}

function vertexLayout(element: PlyElement): VertexLayout {
  const index = (name: string): number =>
    element.properties.findIndex((p) => p.name.toLowerCase() === name)
  const xyz = ['x', 'y', 'z'].map(index)
  if (xyz.some((i) => i < 0)) throw new PlyError('PLY vertex element has no x/y/z properties.')
  const pick = (sets: string[][]): number[] | null => {
    for (const names of sets) {
      const found = names.map(index)
      if (found.every((i) => i >= 0)) return found
    }
    return null
  }
  return { xyz, rgb: pick(COLOR_NAME_SETS), uv: pick(UV_NAME_SETS) }
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

/**
 * What one pass writes into: the arrays both encodings fill.
 *
 * A record rather than eight positional parameters, which is what the two
 * parsers' signatures had grown to before UVs were added to them.
 */
interface PlySink {
  positions: Float64Array
  colors: Uint8Array | null
  uvs: Float32Array | null
  faces: number[]
  /** (corner·2), parallel to `faces`, when the face element carries texcoord. */
  cornerUvs: number[] | null
}

/**
 * A polygon's vertex indices as a triangle fan — trimesh's own triangulation.
 *
 * `tex` is that polygon's per-corner UVs when the file gave any, and is fanned
 * the SAME way so corner k of a triangle keeps the coordinates of the corner it
 * came from. Fanning the indices and leaving the UVs behind would put a quad's
 * texture on backwards without failing anything.
 */
function fan(poly: number[], tex: number[] | null, sink: PlySink): void {
  for (let i = 2; i < poly.length; i++) {
    sink.faces.push(poly[0], poly[i - 1], poly[i])
    if (sink.cornerUvs) {
      const at = (k: number) => {
        const u = tex && k * 2 + 1 < tex.length ? tex[k * 2] : 0
        const v = tex && k * 2 + 1 < tex.length ? tex[k * 2 + 1] : 0
        sink.cornerUvs!.push(u, v)
      }
      at(0)
      at(i - 1)
      at(i)
    }
  }
}

/**
 * Pull one face row's lists apart: the vertex indices, and the per-corner UVs
 * if the element declares them.
 *
 * The first list that is NOT the texcoord one is the polygon — PLY's own rule,
 * and why this walks the declared properties instead of assuming the row opens
 * with its index count.
 */
function faceLists(
  element: PlyElement,
  nextList: () => number[],
  skipScalar: () => void,
): { poly: number[]; tex: number[] | null } {
  let poly: number[] = []
  let tex: number[] | null = null
  for (const property of element.properties) {
    if (property.countType === null) {
      skipScalar()
      continue
    }
    const list = nextList()
    if (property.name.toLowerCase() === FACE_UV_PROPERTY) tex = list
    else if (poly.length === 0) poly = list
  }
  return { poly, tex }
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

  const faceElement = elements.find((e) => e.name.toLowerCase() === 'face')
  // Face coordinates win over vertex ones, trimesh's own precedence — a file
  // carrying both is saying the per-corner set is the authoritative one.
  const faceUv =
    faceElement?.properties.some((q) => q.name.toLowerCase() === FACE_UV_PROPERTY) ?? false

  const sink: PlySink = {
    positions: new Float64Array(vertexElement.count * 3),
    colors: layout.rgb ? new Uint8Array(vertexElement.count * 3) : null,
    uvs: layout.uv && !faceUv ? new Float32Array(vertexElement.count * 2) : null,
    faces: [],
    cornerUvs: faceUv ? [] : null,
  }

  if (format === 'ascii') {
    parseAscii(bytes, bodyAt, elements, vertexElement, layout, sink)
  } else {
    parseBinary(bytes, bodyAt, format === 'binary_little_endian', elements, vertexElement, layout, sink)
  }

  return {
    positions: sink.positions,
    colors: sink.colors,
    indices: sink.faces.length > 0 ? Uint32Array.from(sink.faces) : null,
    uvs: sink.uvs,
    cornerUvs:
      sink.cornerUvs && sink.cornerUvs.length > 0 ? Float32Array.from(sink.cornerUvs) : null,
    vertexCount: vertexElement.count,
  }
}

function parseAscii(
  bytes: Uint8Array,
  bodyAt: number,
  elements: PlyElement[],
  vertexElement: PlyElement,
  layout: VertexLayout,
  sink: PlySink,
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
        for (let a = 0; a < 3; a++) sink.positions[i * 3 + a] = values[layout.xyz[a]]
        if (sink.colors && layout.rgb) {
          for (let a = 0; a < 3; a++) {
            const q = element.properties[layout.rgb[a]]
            sink.colors[i * 3 + a] = colorByte(values[layout.rgb[a]], q.type)
          }
        }
        if (sink.uvs && layout.uv) {
          for (let a = 0; a < 2; a++) sink.uvs[i * 2 + a] = values[layout.uv[a]]
        }
      } else if (isFace && values.length >= 4) {
        // Each list on the row is a leading count followed by that many values.
        let cursor = 0
        const { poly, tex } = faceLists(
          element,
          () => {
            const n = values[cursor++]
            const list = values.slice(cursor, cursor + n)
            cursor += n
            return list
          },
          () => {
            cursor++
          },
        )
        if (poly.length >= 3) fan(poly, tex, sink)
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
  layout: VertexLayout,
  sink: PlySink,
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
            const q = element.properties[layout.xyz[a]]
            sink.positions[i * 3 + a] = readScalar(view, at + offsets[layout.xyz[a]], q.type, little)
          }
          if (sink.colors && layout.rgb) {
            for (let a = 0; a < 3; a++) {
              const q = element.properties[layout.rgb[a]]
              const raw = readScalar(view, at + offsets[layout.rgb[a]], q.type, little)
              sink.colors[i * 3 + a] = colorByte(raw, q.type)
            }
          }
          if (sink.uvs && layout.uv) {
            for (let a = 0; a < 2; a++) {
              const q = element.properties[layout.uv[a]]
              sink.uvs[i * 2 + a] = readScalar(view, at + offsets[layout.uv[a]], q.type, little)
            }
          }
        }
        at += stride
        continue
      }

      // A row carrying a list property has to be walked property by property.
      let column = 0
      const { poly, tex } = faceLists(
        element,
        () => {
          const q = element.properties[column++]
          const countType = q.countType as string
          const n = readScalar(view, at, countType, little)
          at += sizeOf(countType)
          const width = sizeOf(q.type)
          const list: number[] = []
          for (let k = 0; k < n; k++) {
            if (isFace) list.push(readScalar(view, at, q.type, little))
            at += width
          }
          return list
        },
        () => {
          at += sizeOf(element.properties[column++].type)
        },
      )
      if (isFace && poly.length >= 3) fan(poly, tex, sink)
    }
  }
}
