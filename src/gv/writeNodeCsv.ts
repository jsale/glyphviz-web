// Writer for the GlyphViz gv_node.csv format — the minimal (authoring)
// dialect, not the canonical 94-column layout the desktop's save_node_csv
// emits. The desktop loader reads either (only the 20 required columns are
// mandatory), so web-saved files round-trip through desktop GlyphViz.
//
// Formatting rules from node-csv-format.md (File formatting rules):
// UTF-8, CRLF line endings, floats with 6 decimal places, ints bare.
// Optional columns follow the spec's write-only-when-needed convention so a
// load→save cycle never invents columns the data doesn't use; unknown
// columns from `extras` are appended verbatim.

import type { GvNode } from './types'
import {
  DEFAULT_TOPO_SCALE,
  REF_GRID_DEFAULT_RGB,
  RotationMode,
  TAG_DEFAULT_FONT_SIZE,
  TAG_DEFAULT_TEXT_RGB,
  TagColorMode,
} from './types'

const CRLF = '\r\n'

function fmtFloat(v: number): string {
  return v.toFixed(6)
}

function fmtInt(v: number): string {
  return String(Math.trunc(v))
}

/**
 * Significant-figure float, the desktop's `f'{v:.10g}'` (_PRECISE_FLOAT_COLS).
 *
 * `topo_scale` is a MULTIPLIER whose useful range spans several orders of
 * magnitude (1.0 down to TOPO_SCALE_ANTZ = 1/180 and below), where the
 * fixed 6 decimal places every other float column takes would quietly round
 * 0.005555555… to four significant figures. Trailing zeros are stripped, so a
 * node left at the default writes a bare "1" as it does there.
 */
function fmtPrecise(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  if (v === 0) return '0'
  const s = v.toPrecision(10)
  // toPrecision pads to the full width ("1.000000000"); %g does not.
  const [mantissa, exponent] = s.split('e')
  const trimmed = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa
  return exponent === undefined ? trimmed : `${trimmed}e${exponent}`
}

/** RFC 4180 quoting: only when the field needs it. */
function escapeField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

interface Column {
  name: string
  value: (n: GvNode) => string
}

export interface WriteNodeCsvOptions {
  /**
   * Write `text`/`link` as inline columns (default). Set false for a scene
   * whose labels came from a companion gv_tag.csv: the tag file is written
   * alongside instead, preserving the scene's authoring style rather than
   * silently converting it to inline labels (which, per the spec's absolute
   * precedence rule, would then shadow the tag file on reload).
   */
  inlineLabels?: boolean
}

export function writeGvNodeCsv(nodes: GvNode[], options: WriteNodeCsvOptions = {}): string {
  const inlineLabels = options.inlineLabels ?? true
  const columns: Column[] = [
    { name: 'id', value: (n) => fmtInt(n.id) },
    { name: 'type', value: (n) => fmtInt(n.type) },
    { name: 'parent_id', value: (n) => fmtInt(n.parentId) },
    { name: 'branch_level', value: (n) => fmtInt(n.branchLevel) },
    { name: 'translate_x', value: (n) => fmtFloat(n.translate.x) },
    { name: 'translate_y', value: (n) => fmtFloat(n.translate.y) },
    { name: 'translate_z', value: (n) => fmtFloat(n.translate.z) },
    { name: 'rotate_x', value: (n) => fmtFloat(n.rotate.x) },
    { name: 'rotate_y', value: (n) => fmtFloat(n.rotate.y) },
    { name: 'rotate_z', value: (n) => fmtFloat(n.rotate.z) },
    { name: 'scale_x', value: (n) => fmtFloat(n.scale.x) },
    { name: 'scale_y', value: (n) => fmtFloat(n.scale.y) },
    { name: 'scale_z', value: (n) => fmtFloat(n.scale.z) },
    { name: 'color_r', value: (n) => fmtInt(n.color.r) },
    { name: 'color_g', value: (n) => fmtInt(n.color.g) },
    { name: 'color_b', value: (n) => fmtInt(n.color.b) },
    { name: 'color_a', value: (n) => fmtInt(n.color.a) },
    { name: 'geometry', value: (n) => fmtInt(n.geometry) },
    { name: 'hide', value: (n) => fmtInt(n.hide) },
    { name: 'topo', value: (n) => fmtInt(n.topo) },
    // Always written, matching the repo's 22-column example files. Facet is
    // the on-disk (1-indexed) spelling of subspace, per save_node_csv.
    { name: 'ratio', value: (n) => fmtFloat(n.ratio) },
    { name: 'facet', value: (n) => fmtInt(n.subspace + 1) },
  ]

  // Optional columns, written only when omitting them would misread on
  // reload (the spec's extension-column rule).
  const any = (pred: (n: GvNode) => boolean) => nodes.some(pred)
  const optional: Array<{ when: boolean; cols: Column[] }> = [
    {
      // No ANTz/GaiaViz column slot: an omitted column reloads as 1.0 (a
      // translate unit is a world unit), so only a scene with a retuned parent
      // needs it. That is what keeps every pre-existing file byte-identical
      // through a load → save round trip.
      when: any((n) => n.topoScale !== DEFAULT_TOPO_SCALE),
      cols: [{ name: 'topo_scale', value: (n) => fmtPrecise(n.topoScale) }],
    },
    {
      when: any((n) => n.textureId !== 0),
      cols: [{ name: 'texture_id', value: (n) => fmtInt(n.textureId) }],
    },
    {
      when: any((n) => n.meshId !== 0),
      cols: [{ name: 'mesh_id', value: (n) => fmtInt(n.meshId) }],
    },
    {
      // Absent column loads as Heading/Tilt/Roll (1), so only mode 1 files
      // may omit it.
      when: any((n) => n.rotationMode !== RotationMode.HeadingTiltRoll),
      cols: [{ name: 'rotation_mode', value: (n) => fmtInt(n.rotationMode) }],
    },
    {
      when: any((n) => n.colorIndex !== 0),
      cols: [{ name: 'color_index', value: (n) => fmtInt(n.colorIndex) }],
    },
    {
      when: any((n) => n.paletteId !== 0),
      cols: [{ name: 'palette_id', value: (n) => fmtInt(n.paletteId) }],
    },
    {
      when: any((n) => n.translateRate.x !== 0 || n.translateRate.y !== 0 || n.translateRate.z !== 0),
      cols: [
        { name: 'translate_rate_x', value: (n) => fmtFloat(n.translateRate.x) },
        { name: 'translate_rate_y', value: (n) => fmtFloat(n.translateRate.y) },
        { name: 'translate_rate_z', value: (n) => fmtFloat(n.translateRate.z) },
      ],
    },
    {
      when: any((n) => n.rotateRate.x !== 0 || n.rotateRate.y !== 0 || n.rotateRate.z !== 0),
      cols: [
        { name: 'rotate_rate_x', value: (n) => fmtFloat(n.rotateRate.x) },
        { name: 'rotate_rate_y', value: (n) => fmtFloat(n.rotateRate.y) },
        { name: 'rotate_rate_z', value: (n) => fmtFloat(n.rotateRate.z) },
      ],
    },
    {
      when: any((n) => n.scaleRate.x !== 0 || n.scaleRate.y !== 0 || n.scaleRate.z !== 0),
      cols: [
        { name: 'scale_rate_x', value: (n) => fmtFloat(n.scaleRate.x) },
        { name: 'scale_rate_y', value: (n) => fmtFloat(n.scaleRate.y) },
        { name: 'scale_rate_z', value: (n) => fmtFloat(n.scaleRate.z) },
      ],
    },
    {
      when: inlineLabels && any((n) => n.text !== ''),
      cols: [{ name: 'text', value: (n) => n.text }],
    },
    {
      when: inlineLabels && any((n) => n.link !== ''),
      cols: [{ name: 'link', value: (n) => n.link }],
    },
    {
      // No ANTz/GaiaViz column slot, so an omitted column means 0 — which is
      // the default, so only a scene that pins something needs to write it.
      when: any((n) => n.showText !== 0),
      cols: [{ name: 'show_text', value: (n) => fmtInt(n.showText) }],
    },
    {
      when: any((n) => n.renderMode !== 0),
      cols: [{ name: 'render_mode', value: (n) => fmtInt(n.renderMode) }],
    },
    {
      when: any((n) => n.fogEnabled !== 0 || n.fogStart !== 0 || n.fogEnd !== 0),
      cols: [
        { name: 'fog_enabled', value: (n) => fmtInt(n.fogEnabled) },
        { name: 'fog_start', value: (n) => fmtFloat(n.fogStart) },
        { name: 'fog_end', value: (n) => fmtFloat(n.fogEnd) },
      ],
    },
    // Tag styling, World-row data like the fog fields above. The two groups
    // are independent: a scene may recolour its labels without leaving the
    // uniform mode, or switch to per-node colour without ever picking one.
    {
      when: any((n) => n.tagColorMode !== TagColorMode.Uniform),
      cols: [{ name: 'tag_color_mode', value: (n) => fmtInt(n.tagColorMode) }],
    },
    {
      when: any(
        (n) =>
          n.tagColor.r !== TAG_DEFAULT_TEXT_RGB.r ||
          n.tagColor.g !== TAG_DEFAULT_TEXT_RGB.g ||
          n.tagColor.b !== TAG_DEFAULT_TEXT_RGB.b,
      ),
      cols: [
        { name: 'tag_color_r', value: (n) => fmtInt(n.tagColor.r) },
        { name: 'tag_color_g', value: (n) => fmtInt(n.tagColor.g) },
        { name: 'tag_color_b', value: (n) => fmtInt(n.tagColor.b) },
      ],
    },
    {
      // Written only when someone actually changed the size, which is what
      // keeps every scene that never touched it column-stable through a
      // load/save round trip.
      when: any((n) => n.tagFontSize !== TAG_DEFAULT_FONT_SIZE),
      cols: [{ name: 'tag_font_size', value: (n) => fmtInt(n.tagFontSize) }],
    },
    {
      // The backdrop grid's colour, World-row data like the tag styling above.
      when: any(
        (n) =>
          n.refGridColor.r !== REF_GRID_DEFAULT_RGB.r ||
          n.refGridColor.g !== REF_GRID_DEFAULT_RGB.g ||
          n.refGridColor.b !== REF_GRID_DEFAULT_RGB.b,
      ),
      cols: [
        { name: 'ref_grid_color_r', value: (n) => fmtInt(n.refGridColor.r) },
        { name: 'ref_grid_color_g', value: (n) => fmtInt(n.refGridColor.g) },
        { name: 'ref_grid_color_b', value: (n) => fmtInt(n.refGridColor.b) },
      ],
    },
  ]
  for (const group of optional) {
    if (group.when) columns.push(...group.cols)
  }

  // Unknown columns, preserved verbatim in first-seen order across nodes.
  const extraNames: string[] = []
  for (const n of nodes) {
    for (const name of Object.keys(n.extras)) {
      if (!extraNames.includes(name)) extraNames.push(name)
    }
  }
  for (const name of extraNames) {
    columns.push({ name, value: (n) => n.extras[name] ?? '' })
  }

  const lines = [columns.map((c) => escapeField(c.name)).join(',')]
  for (const n of nodes) {
    lines.push(columns.map((c) => escapeField(c.value(n))).join(','))
  }
  return lines.join(CRLF) + CRLF
}
