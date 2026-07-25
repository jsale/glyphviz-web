// Writer for the companion gv_tag.csv label file, the inverse of
// parseGvTagCsv. Mirrors the desktop's save_tag_csv: one row per node with a
// non-empty text or link, `id` a 0-based row counter, `table_id` always 0,
// `record_id` from the node's record_id extra (else its id), and `title` an
// HTML anchor when a link is set, else the plain label. UTF-8, CRLF.

import type { GvNode } from './types'

const CRLF = '\r\n'

/** RFC 4180 quoting: only when the field needs it. */
function escapeField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export function writeGvTagCsv(nodes: GvNode[]): string {
  const lines = ['id,table_id,record_id,title']
  let tagId = 0
  for (const node of nodes) {
    if (node.text === '' && node.link === '') continue
    const title = node.link ? `<a href="${node.link}">${node.text}</a>` : node.text
    const recordId = node.extras['record_id'] ?? String(node.id)
    lines.push([String(tagId), '0', escapeField(recordId), escapeField(title)].join(','))
    tagId++
  }
  return lines.join(CRLF) + CRLF
}

/** True when any node carries a label worth writing a tag file for. */
export function hasAnyLabel(nodes: GvNode[]): boolean {
  return nodes.some((n) => n.text !== '' || n.link !== '')
}
