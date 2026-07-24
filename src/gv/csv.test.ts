import { describe, expect, it } from 'vitest'
import { tokenizeCsv } from './csv'

describe('tokenizeCsv', () => {
  it('splits simple rows and fields', () => {
    expect(tokenizeCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles CRLF line endings (what desktop GlyphViz writes)', () => {
    expect(tokenizeCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('drops a trailing empty line but keeps interior empty fields', () => {
    expect(tokenizeCsv('a,,c\n')).toEqual([['a', '', 'c']])
  })

  it('reads quoted fields containing commas and newlines', () => {
    expect(tokenizeCsv('"hello, world","line1\nline2"')).toEqual([
      ['hello, world', 'line1\nline2'],
    ])
  })

  it('unescapes doubled quotes inside quoted fields', () => {
    expect(tokenizeCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']])
  })

  it('strips a UTF-8 BOM', () => {
    const bom = String.fromCharCode(0xfeff)
    expect(tokenizeCsv(bom + 'id,type\n1,5')).toEqual([
      ['id', 'type'],
      ['1', '5'],
    ])
  })

  it('returns no rows for empty input', () => {
    expect(tokenizeCsv('')).toEqual([])
  })
})
