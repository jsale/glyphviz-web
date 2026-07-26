// Parser for the GlyphViz gv_node.csv format (minimal/authoring dialect).
//
// Authoritative spec: glyphviz repo, glyphviz-skill/references/node-csv-format.md.
// Columns are read by header name, order-independent, matching the desktop
// loader. The 20 required columns are fatal when missing; every optional
// tracked column falls back to its documented load-time default; unknown
// columns are preserved verbatim in `extras`.

import { tokenizeCsv } from './csv'
import {
  GEOMETRY_MAX,
  REF_GRID_DEFAULT_RGB,
  TAG_DEFAULT_TEXT_RGB,
  TagColorMode,
  TOPO_MAX,
} from './types'
import type { GvNode, GvNodeParseResult, GvParseIssue, Vec3 } from './types'

export const REQUIRED_COLUMNS = [
  'id',
  'type',
  'parent_id',
  'branch_level',
  'translate_x',
  'translate_y',
  'translate_z',
  'rotate_x',
  'rotate_y',
  'rotate_z',
  'scale_x',
  'scale_y',
  'scale_z',
  'color_r',
  'color_g',
  'color_b',
  'color_a',
  'geometry',
  'hide',
  'topo',
] as const

// Optional columns read into typed Node fields. Anything not listed here or
// in REQUIRED_COLUMNS lands in `extras`.
const OPTIONAL_TRACKED_COLUMNS = [
  'ratio',
  'subspace',
  'facet',
  'texture_id',
  'mesh_id',
  'rotation_mode',
  'color_index',
  'palette_id',
  'translate_rate_x',
  'translate_rate_y',
  'translate_rate_z',
  'rotate_rate_x',
  'rotate_rate_y',
  'rotate_rate_z',
  'scale_rate_x',
  'scale_rate_y',
  'scale_rate_z',
  'text',
  'link',
  'show_text',
  'render_mode',
  'fog_enabled',
  'fog_start',
  'fog_end',
  'tag_color_mode',
  'tag_color_r',
  'tag_color_g',
  'tag_color_b',
  'ref_grid_color_r',
  'ref_grid_color_g',
  'ref_grid_color_b',
] as const

const TRACKED = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_TRACKED_COLUMNS])

export function parseGvNodeCsv(text: string): GvNodeParseResult {
  const errors: GvParseIssue[] = []
  const warnings: GvParseIssue[] = []
  const nodes: GvNode[] = []
  const fail = (result?: Partial<GvNodeParseResult>): GvNodeParseResult => ({
    nodes: [],
    errors,
    warnings,
    hasInlineLabelColumns: false,
    ...result,
  })

  const rows = tokenizeCsv(text)
  if (rows.length === 0) {
    errors.push({ message: 'File is empty.' })
    return fail()
  }

  const header = rows[0].map((h) => h.trim())

  if (header[0] === 'np_node_id') {
    errors.push({
      line: 1,
      message:
        'This is a GaiaViz np_-dialect file, which GlyphViz Web does not support. ' +
        'Load it in desktop GlyphViz and re-save to convert.',
    })
    return fail()
  }

  const col = new Map<string, number>()
  for (let i = 0; i < header.length; i++) {
    const name = header[i]
    if (name === '') continue
    if (col.has(name)) {
      errors.push({ line: 1, column: name, message: `Duplicate column "${name}".` })
      return fail()
    }
    col.set(name, i)
  }

  const missing = REQUIRED_COLUMNS.filter((name) => !col.has(name))
  if (missing.length > 0) {
    errors.push({
      line: 1,
      message: `Missing required column(s): ${missing.join(', ')}.`,
    })
    return fail()
  }

  const hasInlineLabelColumns = col.has('text') || col.has('link')
  const extrasColumns = header.filter((name) => name !== '' && !TRACKED.has(name))

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const line = r + 1
    if (row.length === 1 && row[0].trim() === '') continue

    if (row.length !== header.length) {
      errors.push({
        line,
        message: `Expected ${header.length} field(s), found ${row.length}; row skipped.`,
      })
      continue
    }

    let rowBad = false
    const cell = (name: string): string | undefined => {
      const ix = col.get(name)
      return ix === undefined ? undefined : row[ix].trim()
    }

    // Required numeric field: a bad value invalidates the whole row.
    const req = (name: string, integer: boolean): number => {
      const raw = cell(name)!
      const value = raw === '' ? NaN : Number(raw)
      if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
        errors.push({
          line,
          column: name,
          message: `Invalid ${integer ? 'integer' : 'number'} "${raw}"; row skipped.`,
        })
        rowBad = true
        return 0
      }
      return value
    }

    // Optional numeric field: absent column or empty/bad cell → load default.
    const opt = (name: string, def: number, integer: boolean): number => {
      const raw = cell(name)
      if (raw === undefined || raw === '') return def
      const value = Number(raw)
      if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
        warnings.push({
          line,
          column: name,
          message: `Invalid ${integer ? 'integer' : 'number'} "${raw}"; using default ${def}.`,
        })
        return def
      }
      return value
    }

    const reqVec3 = (base: string): Vec3 => ({
      x: req(`${base}_x`, false),
      y: req(`${base}_y`, false),
      z: req(`${base}_z`, false),
    })
    const optVec3 = (base: string): Vec3 => ({
      x: opt(`${base}_x`, 0, false),
      y: opt(`${base}_y`, 0, false),
      z: opt(`${base}_z`, 0, false),
    })

    const channel = (name: string): number => {
      const value = req(name, true)
      if (rowBad) return 0
      if (value < 0 || value > 255) {
        warnings.push({
          line,
          column: name,
          message: `Color channel ${value} out of range 0–255; clamped.`,
        })
        return Math.min(255, Math.max(0, value))
      }
      return value
    }

    // `subspace` (0-indexed) wins over legacy `facet` (1-indexed), clipped at 0.
    const subspace = col.has('subspace')
      ? Math.max(0, opt('subspace', 0, true))
      : Math.max(0, opt('facet', 1, true) - 1)

    const node: GvNode = {
      id: req('id', true),
      type: req('type', true),
      parentId: req('parent_id', true),
      branchLevel: req('branch_level', true),
      translate: reqVec3('translate'),
      rotate: reqVec3('rotate'),
      scale: reqVec3('scale'),
      color: { r: channel('color_r'), g: channel('color_g'), b: channel('color_b'), a: channel('color_a') },
      geometry: req('geometry', true),
      hide: req('hide', true),
      topo: req('topo', true),

      ratio: opt('ratio', 0.1, false),
      subspace,
      textureId: opt('texture_id', 0, true),
      meshId: opt('mesh_id', 0, true),
      // Asymmetric by design: an absent column means the file predates the
      // feature and loads as Heading/Tilt/Roll (1), not the code default (0).
      rotationMode: opt('rotation_mode', 1, true),
      colorIndex: opt('color_index', 0, true),
      paletteId: opt('palette_id', 0, true),
      translateRate: optVec3('translate_rate'),
      rotateRate: optVec3('rotate_rate'),
      scaleRate: optVec3('scale_rate'),
      text: cell('text') ?? '',
      link: cell('link') ?? '',
      showText: opt('show_text', 0, true),
      renderMode: opt('render_mode', 0, true),
      fogEnabled: opt('fog_enabled', 0, true),
      fogStart: opt('fog_start', 0, false),
      fogEnd: opt('fog_end', 0, false),
      tagColorMode: opt('tag_color_mode', TagColorMode.Uniform, true),
      tagColor: {
        r: opt('tag_color_r', TAG_DEFAULT_TEXT_RGB.r, true),
        g: opt('tag_color_g', TAG_DEFAULT_TEXT_RGB.g, true),
        b: opt('tag_color_b', TAG_DEFAULT_TEXT_RGB.b, true),
      },
      refGridColor: {
        r: opt('ref_grid_color_r', REF_GRID_DEFAULT_RGB.r, true),
        g: opt('ref_grid_color_g', REF_GRID_DEFAULT_RGB.g, true),
        b: opt('ref_grid_color_b', REF_GRID_DEFAULT_RGB.b, true),
      },

      extras: {},
    }
    if (rowBad) continue

    for (const name of extrasColumns) {
      node.extras[name] = row[col.get(name)!]
    }

    if (node.geometry < 0 || node.geometry > GEOMETRY_MAX) {
      warnings.push({
        line,
        column: 'geometry',
        message: `Unknown geometry id ${node.geometry} (valid range 0–${GEOMETRY_MAX}).`,
      })
    }
    if (node.topo < 0 || node.topo > TOPO_MAX) {
      warnings.push({
        line,
        column: 'topo',
        message: `Unknown topology id ${node.topo} (valid range 0–${TOPO_MAX}).`,
      })
    }
    if (node.id < 1) {
      warnings.push({
        line,
        column: 'id',
        message: `Node id ${node.id} < 1 (0 is reserved as the root parent sentinel).`,
      })
    }

    nodes.push(node)
  }

  // Hierarchy sanity checks (warnings only — the desktop loader tolerates these).
  const ids = new Set<number>()
  for (const node of nodes) {
    if (ids.has(node.id)) {
      warnings.push({ column: 'id', message: `Duplicate node id ${node.id}.` })
    }
    ids.add(node.id)
  }
  for (const node of nodes) {
    if (node.parentId !== 0 && !ids.has(node.parentId)) {
      warnings.push({
        column: 'parent_id',
        message: `Node ${node.id} references missing parent ${node.parentId}.`,
      })
    }
  }

  return { nodes, errors, warnings, hasInlineLabelColumns }
}
