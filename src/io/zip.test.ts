// The zip reader — and browserFiles' expandZips glue on top of it — exercised
// against REAL archives built here byte by byte (and deflated with the
// platform's own CompressionStream), not fixtures: a hand-written format
// parser is only trustworthy against bytes a conforming archiver would
// actually produce.

import { describe, expect, it } from 'vitest'
import { expandZips } from './browserFiles'
import { looksLikeZip, MAX_ENTRIES, readZip } from './zip'

interface Member {
  path: string
  content: string | Uint8Array
  /** Store (0) or deflate (8). */
  method?: number
  /** General purpose bit flags, for the encrypted/UTF-8 cases. */
  flags?: number
}

const utf8 = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** CRC-32, so the archives are honest even though the reader doesn't check it. */
function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

/** A minimal but conforming zip: local headers, central directory, EOCD. */
async function makeZip(members: Member[], comment = ''): Promise<Blob> {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const member of members) {
    const raw = typeof member.content === 'string' ? utf8(member.content) : member.content
    const method = member.method ?? 8
    const flags = member.flags ?? 0
    const stored = method === 8 ? await deflateRaw(raw) : raw
    const name = utf8(member.path)
    const crc = crc32(raw)

    const local = new Uint8Array(30 + name.length + stored.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, flags, true)
    lv.setUint16(8, method, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, stored.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(stored, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, flags, true)
    cv.setUint16(10, method, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, stored.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const cdSize = centrals.reduce((sum, c) => sum + c.length, 0)
  const commentBytes = utf8(comment)
  const eocd = new Uint8Array(22 + commentBytes.length)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, members.length, true)
  ev.setUint16(10, members.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, commentBytes.length, true)
  eocd.set(commentBytes, 22)

  return new Blob([...locals, ...centrals, eocd] as unknown as BlobPart[])
}

const NODE_CSV = 'id,type,parent_id\n1,5,0\n'

describe('looksLikeZip', () => {
  it('matches on the extension, case-insensitively', () => {
    expect(looksLikeZip('Scene.zip')).toBe(true)
    expect(looksLikeZip('SCENE.ZIP')).toBe(true)
    expect(looksLikeZip('scene_gv_node.csv')).toBe(false)
    expect(looksLikeZip('zip')).toBe(false)
  })
})

describe('readZip', () => {
  it('reads deflated and stored members alike', async () => {
    const blob = await makeZip([
      { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV, method: 8 },
      { path: 'Scene/Scene_gv_tag.csv', content: 'id,text\n1,hello\n', method: 0 },
    ])
    const { entries, warnings } = await readZip(blob)
    expect(warnings).toEqual([])
    expect(entries.map((e) => e.path)).toEqual([
      'Scene/Scene_gv_node.csv',
      'Scene/Scene_gv_tag.csv',
    ])
    expect(text(entries[0].bytes)).toBe(NODE_CSV)
    expect(text(entries[1].bytes)).toBe('id,text\n1,hello\n')
  })

  it('round-trips binary content byte for byte', async () => {
    // Random-ish bytes: deflate cannot shrink them, so the stored path and the
    // length bookkeeping both get exercised on a member that grows.
    const bytes = new Uint8Array(4096)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + (i >> 3)) & 0xff
    const blob = await makeZip([{ path: 'Scene/media/tex.png', content: bytes }])
    const { entries } = await readZip(blob)
    expect(entries[0].bytes).toEqual(bytes)
  })

  it('finds the central directory behind an archive comment', async () => {
    // The EOCD signature can also appear inside the comment; the length check
    // is what keeps the scan from stopping on it.
    const comment = 'PK not the real record, just bytes that look like it'
    const blob = await makeZip([{ path: 'a_gv_node.csv', content: NODE_CSV }], comment)
    const { entries } = await readZip(blob)
    expect(entries.map((e) => e.path)).toEqual(['a_gv_node.csv'])
  })

  it('skips directory records and keeps only files', async () => {
    const blob = await makeZip([
      { path: 'Scene/', content: '', method: 0 },
      { path: 'Scene/media/', content: '', method: 0 },
      { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV },
    ])
    const { entries } = await readZip(blob)
    expect(entries.map((e) => e.path)).toEqual(['Scene/Scene_gv_node.csv'])
  })

  it('drops the macOS shadow tree that would otherwise look like a scene', async () => {
    // __MACOSX/…/._Scene_gv_node.csv passes looksLikeNodeCsv, so leaving it in
    // puts a second, broken scene in the picker.
    const blob = await makeZip([
      { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV },
      { path: '__MACOSX/Scene/._Scene_gv_node.csv', content: 'junk' },
      { path: 'Scene/._Scene_gv_node.csv', content: 'junk' },
      { path: 'Scene/.DS_Store', content: 'junk' },
    ])
    const { entries } = await readZip(blob)
    expect(entries.map((e) => e.path)).toEqual(['Scene/Scene_gv_node.csv'])
  })

  it('skips an encrypted member and says so, keeping the rest', async () => {
    const blob = await makeZip([
      { path: 'Scene/secret.csv', content: NODE_CSV, flags: 0x0001 },
      { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV },
    ])
    const { entries, warnings } = await readZip(blob)
    expect(entries.map((e) => e.path)).toEqual(['Scene/Scene_gv_node.csv'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('encrypted')
  })

  it('skips a member compressed with a method it cannot inflate', async () => {
    const blob = await makeZip([
      { path: 'Scene/bz.csv', content: NODE_CSV, method: 12 },
      { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV },
    ])
    const { entries, warnings } = await readZip(blob)
    expect(entries.map((e) => e.path)).toEqual(['Scene/Scene_gv_node.csv'])
    expect(warnings[0]).toContain('compression method 12')
  })

  it('normalizes backslashed and absolute member paths', async () => {
    const blob = await makeZip([
      { path: 'Scene\\media\\tex.png', content: 'x' },
      { path: '/Scene/Scene_gv_node.csv', content: NODE_CSV },
    ])
    const { entries } = await readZip(blob)
    expect(entries.map((e) => e.path)).toEqual(['Scene/media/tex.png', 'Scene/Scene_gv_node.csv'])
  })

  it('decodes UTF-8 member names', async () => {
    const blob = await makeZip([{ path: 'Scène/Ω_gv_node.csv', content: NODE_CSV, flags: 0x0800 }])
    const { entries } = await readZip(blob)
    expect(entries[0].path).toBe('Scène/Ω_gv_node.csv')
  })

  it('rejects something that is not a zip at all', async () => {
    await expect(readZip(new Blob([NODE_CSV]))).rejects.toThrow(/not a zip archive/)
  })

  it('rejects an archive with absurdly many entries before reading any', async () => {
    // Only the EOCD's count is faked — the reader must bail on it, not walk
    // a central directory that claims 20001 members.
    const blob = await makeZip([{ path: 'a.csv', content: NODE_CSV }])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const dv = new DataView(bytes.buffer)
    dv.setUint16(bytes.length - 22 + 10, MAX_ENTRIES + 1, true)
    await expect(readZip(new Blob([bytes as unknown as BlobPart]))).rejects.toThrow(/the limit is/)
  })

  it('reports an unreadable member without losing the readable ones', async () => {
    const blob = await makeZip([
      { path: 'Scene/broken.csv', content: NODE_CSV },
      { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV },
    ])
    // Corrupt the first member's local header signature.
    const bytes = new Uint8Array(await blob.arrayBuffer())
    bytes[0] = 0x00
    const { entries, warnings } = await readZip(new Blob([bytes as unknown as BlobPart]))
    expect(entries.map((e) => e.path)).toEqual(['Scene/Scene_gv_node.csv'])
    expect(warnings[0]).toContain('Scene/broken.csv')
  })
})

/** A PathedFile carrying an archive, as a drop or picker would deliver it. */
async function zipFile(name: string, members: Member[]) {
  const blob = await makeZip(members)
  return { path: name, file: new File([blob], name, { type: 'application/zip' }) }
}

describe('expandZips', () => {
  it('keeps the archive’s own top folder when it has one', async () => {
    const { files, warnings } = await expandZips([
      await zipFile('Surface_Example.zip', [
        { path: 'Surface_Example/Surface_Example_gv_node.csv', content: NODE_CSV },
        { path: 'Surface_Example/media/dem.png', content: 'x' },
      ]),
    ])
    expect(warnings).toEqual([])
    expect(files.map((f) => f.path)).toEqual([
      'Surface_Example/Surface_Example_gv_node.csv',
      'Surface_Example/media/dem.png',
    ])
  })

  it('supplies one from the archive name when the members sit at the root', async () => {
    // "Zip these files" rather than "zip this folder" — without a folder the
    // scene would be labelled after a bare CSV name.
    const { files } = await expandZips([
      await zipFile('Surface_Example.zip', [
        { path: 'Surface_Example_gv_node.csv', content: NODE_CSV },
        { path: 'media/dem.png', content: 'x' },
      ]),
    ])
    expect(files.map((f) => f.path)).toEqual([
      'Surface_Example/Surface_Example_gv_node.csv',
      'Surface_Example/media/dem.png',
    ])
  })

  it('keeps a multi-scene archive’s relative shape', async () => {
    const { files } = await expandZips([
      await zipFile('Global.zip', [
        { path: 'Global/Global_gv_node.csv', content: NODE_CSV },
        { path: 'Global/A/A_gv_node.csv', content: NODE_CSV },
        { path: 'Global/B/B_gv_node.csv', content: NODE_CSV },
      ]),
    ])
    expect(files.map((f) => f.path)).toEqual([
      'Global/Global_gv_node.csv',
      'Global/A/A_gv_node.csv',
      'Global/B/B_gv_node.csv',
    ])
  })

  it('restores a MIME type from the extension so media can play', async () => {
    const { files } = await expandZips([
      await zipFile('Scene.zip', [
        { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV },
        { path: 'Scene/media/clip.mp4', content: 'x' },
        { path: 'Scene/song.wav', content: 'x' },
        { path: 'Scene/notes.unknown', content: 'x' },
      ]),
    ])
    const typeOf = (suffix: string) => files.find((f) => f.path.endsWith(suffix))!.file.type
    expect(typeOf('.csv')).toBe('text/csv')
    expect(typeOf('.mp4')).toBe('video/mp4')
    expect(typeOf('.wav')).toBe('audio/wav')
    expect(typeOf('.unknown')).toBe('')
  })

  it('leaves a set with no archive in it completely alone', async () => {
    const plain = [{ path: 'a_gv_node.csv', file: new File([NODE_CSV], 'a_gv_node.csv') }]
    const result = await expandZips(plain)
    expect(result.files).toBe(plain) // same array — no copying, no reading
    expect(result.warnings).toEqual([])
  })

  it('passes non-archive members of a mixed drop straight through', async () => {
    const loose = { path: 'loose_gv_tag.csv', file: new File(['id,text\n'], 'loose_gv_tag.csv') }
    const { files } = await expandZips([
      loose,
      await zipFile('Scene.zip', [{ path: 'Scene/Scene_gv_node.csv', content: NODE_CSV }]),
    ])
    expect(files.map((f) => f.path)).toEqual(['loose_gv_tag.csv', 'Scene/Scene_gv_node.csv'])
  })

  it('reports an archive it cannot open and keeps going', async () => {
    const { files, warnings } = await expandZips([
      { path: 'broken.zip', file: new File(['definitely not a zip'], 'broken.zip') },
      await zipFile('Scene.zip', [{ path: 'Scene/Scene_gv_node.csv', content: NODE_CSV }]),
    ])
    expect(files.map((f) => f.path)).toEqual(['Scene/Scene_gv_node.csv'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('broken.zip could not be opened')
  })

  it('prefixes a member warning with the archive it came from', async () => {
    const { warnings } = await expandZips([
      await zipFile('Scene.zip', [
        { path: 'Scene/secret.csv', content: NODE_CSV, flags: 0x0001 },
        { path: 'Scene/Scene_gv_node.csv', content: NODE_CSV },
      ]),
    ])
    expect(warnings[0]).toContain('Scene.zip →')
    expect(warnings[0]).toContain('encrypted')
  })

  it('yields readable files: a zipped scene parses like a dropped one', async () => {
    const { files } = await expandZips([
      await zipFile('Scene.zip', [{ path: 'Scene/Scene_gv_node.csv', content: NODE_CSV }]),
    ])
    expect(await files[0].file.text()).toBe(NODE_CSV)
  })
})
