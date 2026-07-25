// Parser for the companion gv_tag.csv label file (ANTz/GaiaViz-compatible).
//
// Authoritative spec: glyphviz repo, glyphviz-skill/references/tags-and-labels.md,
// cross-checked against glyphviz_core/csv_reader.py (_load_tag_file,
// _swap_node_tag_stem, and the tag_data application loop).
//
// Precedence is absolute: a node CSV carrying a `text` or `link` column never
// consults a tag file. Callers gate on GvNodeParseResult.hasInlineLabelColumns.

import { tokenizeCsv } from './csv'
import type { GvNode, GvParseIssue } from './types'

export interface GvTag {
  text: string
  link: string
}

export interface GvTagParseResult {
  /** record_id → label. Later rows win on duplicate ids, as in the desktop dict. */
  byRecordId: Map<number, GvTag>
  /** Data rows seen, including ones skipped for a non-zero table_id. */
  rowCount: number
  warnings: GvParseIssue[]
}

const URL_PREFIXES = ['http://', 'https://', 'www.', 'ftp://']

// Desktop: r'<a\s+href=["\']?([^"\'>\s]+)["\']?>([^<]*)</a>', case-insensitive.
const ANCHOR_RE = /<a\s+href=["']?([^"'>\s]+)["']?>([^<]*)<\/a>/i

/** The desktop saver's stamp: YYYYMMDDHHMMSS, no delimiters. */
const TIMESTAMP_RE = /\d{14}$/

/**
 * Companion tag filename for a node CSV, or null when none is derivable.
 *
 * The desktop *loader* rule (`_swap_node_tag_stem`) is that the stem must end
 * in exactly `node`. Deliberate divergence: a trailing 14-digit save stamp is
 * stripped first, so `scene_gv_node20260725103000.csv` pairs with
 * `scene_gv_tag20260725103000.csv`.
 *
 * That pair is exactly what the desktop's own `stamp_node_and_tag_paths`
 * writes (it strips the stamp before swapping, then re-appends it) — and what
 * its loader then fails to find, so GlyphViz currently writes a pair it cannot
 * read back. Jeff is fixing the desktop side (2026-07-25); until then this
 * keeps the web app able to open the files that already exist on disk.
 */
export function deriveTagFilename(nodeFilename: string): string | null {
  const dot = nodeFilename.lastIndexOf('.')
  const stem = dot === -1 ? nodeFilename : nodeFilename.slice(0, dot)
  const ext = dot === -1 ? '' : nodeFilename.slice(dot)
  const stamp = TIMESTAMP_RE.exec(stem)?.[0] ?? ''
  const base = stamp === '' ? stem : stem.slice(0, -stamp.length)
  if (!base.endsWith('node')) return null
  return base.slice(0, -4) + 'tag' + stamp + ext
}

/**
 * Parse a tag CSV into record_id → {text, link}.
 *
 * Columns: `id, table_id, record_id, title`. `record_id` is mandatory (without
 * it the desktop returns no tags at all); `table_id` defaults to 0 when the
 * column is absent and any non-zero value skips the row; `title` defaults to
 * empty.
 */
export function parseGvTagCsv(text: string): GvTagParseResult {
  const warnings: GvParseIssue[] = []
  const byRecordId = new Map<number, GvTag>()

  const rows = tokenizeCsv(text)
  if (rows.length === 0) {
    warnings.push({ message: 'Tag file is empty; no labels loaded.' })
    return { byRecordId, rowCount: 0, warnings }
  }

  const col = new Map<string, number>()
  rows[0].forEach((name, i) => {
    const key = name.trim()
    if (key !== '' && !col.has(key)) col.set(key, i)
  })

  const recordIx = col.get('record_id')
  if (recordIx === undefined) {
    warnings.push({
      line: 1,
      message: 'Tag file has no record_id column; no labels loaded.',
    })
    return { byRecordId, rowCount: 0, warnings }
  }
  const tableIx = col.get('table_id')
  const titleIx = col.get('title')

  let rowCount = 0
  let skippedTable = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && row[0].trim() === '') continue
    rowCount++

    const recordId = Number(row[recordIx]?.trim() ?? '')
    if (row[recordIx] === undefined || row[recordIx].trim() === '' || !Number.isFinite(recordId)) {
      warnings.push({
        line: r + 1,
        column: 'record_id',
        message: `Invalid record_id "${row[recordIx] ?? ''}"; row skipped.`,
      })
      continue
    }
    // Python int() truncates toward zero, so "3.7" is record 3.
    const key = Math.trunc(recordId)

    if (tableIx !== undefined) {
      const raw = row[tableIx]?.trim() ?? ''
      const tableId = raw === '' ? NaN : Number(raw)
      if (!Number.isFinite(tableId)) continue // desktop: int() raises → row skipped
      if (Math.trunc(tableId) !== 0) {
        skippedTable++
        continue
      }
    }

    // Desktop strips whitespace then a wrapping pair of double quotes; the CSV
    // tokenizer has already removed RFC 4180 quoting by this point.
    const raw = (titleIx === undefined ? '' : (row[titleIx] ?? '')).trim().replace(/^"+|"+$/g, '')
    byRecordId.set(key, parseTagTitle(raw))
  }

  if (skippedTable > 0) {
    warnings.push({
      message: `${skippedTable} tag row(s) ignored for a non-zero table_id.`,
    })
  }
  return { byRecordId, rowCount, warnings }
}

/**
 * Decode one `title` cell into text + link.
 *
 * Three encodings, per spec: an HTML anchor, a bare URL (link = text = URL),
 * or plain text. An anchor with an empty label falls back to the whole raw
 * string, matching the desktop's `m.group(2).strip() or raw`.
 *
 * Deliberate divergence: pandas turns an empty or `None`/`NA`-token title into
 * NaN, which the desktop then stringifies into the literal label "nan". That's
 * an artifact, not a feature — an empty title here yields an empty label, and
 * "None"/"NA" stay literal.
 */
export function parseTagTitle(raw: string): GvTag {
  const m = ANCHOR_RE.exec(raw)
  if (m) {
    return { text: m[2].trim() || raw, link: m[1].replace(/^['"]+|['"]+$/g, '') }
  }
  if (URL_PREFIXES.some((p) => raw.startsWith(p))) {
    return { text: raw, link: raw }
  }
  return { text: raw, link: '' }
}

/**
 * Write tag labels onto nodes, in place. Returns the number of nodes labeled.
 *
 * Only call this when the node CSV had no inline `text`/`link` columns.
 * Matching follows the desktop: the node's `record_id` extra (falling back to
 * its `id` when absent, and — unlike the desktop, which raises — when
 * non-numeric), then a second lookup by `id` if that misses. An entry whose
 * text and link are both empty counts as a miss, mirroring the desktop's
 * `tag_data.get(rid) or tag_data.get(node.id)`.
 */
export function applyTags(nodes: GvNode[], tags: Map<number, GvTag>): number {
  if (tags.size === 0) return 0
  let applied = 0
  const lookup = (key: number): GvTag | undefined => {
    const entry = tags.get(key)
    return entry && (entry.text !== '' || entry.link !== '') ? entry : undefined
  }
  for (const node of nodes) {
    const raw = node.extras['record_id']
    const rid = raw === undefined || raw.trim() === '' ? node.id : Number(raw)
    const entry = (Number.isFinite(rid) ? lookup(Math.trunc(rid)) : undefined) ?? lookup(node.id)
    if (entry) {
      node.text = entry.text
      node.link = entry.link
      applied++
    }
  }
  return applied
}
