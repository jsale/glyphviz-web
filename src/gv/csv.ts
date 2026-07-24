// Minimal RFC 4180 CSV tokenizer.
//
// The desktop app reads gv_ files via pandas, which is RFC 4180-compatible:
// fields may be double-quoted, quoted fields may contain commas, newlines,
// and doubled ("") escaped quotes. Inline `text`/`link` label columns are
// where this matters in practice.

/**
 * Split CSV text into rows of raw string fields.
 *
 * Accepts CRLF or LF line endings, strips a leading UTF-8 BOM, and drops a
 * trailing empty line. Performs no type conversion and no header handling.
 */
export function tokenizeCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else if (ch === '"' && field.length === 0) {
      inQuotes = true
      i++
    } else if (ch === ',') {
      endField()
      i++
    } else if (ch === '\r' && text[i + 1] === '\n') {
      endRow()
      i += 2
    } else if (ch === '\n' || ch === '\r') {
      endRow()
      i++
    } else {
      field += ch
      i++
    }
  }
  // Final field/row unless the file ended exactly on a line break.
  if (field.length > 0 || row.length > 0) endRow()

  return rows
}
