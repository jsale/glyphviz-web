// Animated GIF decoding — the container, the LZW stream, and the compositing
// that turns a sequence of frame rectangles into a sequence of whole images.
//
// Why this exists at all: a browser hands a page only the FIRST frame of a GIF
// it decodes into an ImageBitmap, so a GIF texture was frozen here while the
// desktop plays it (Dave Warner's parity probe, 2026-10-21). WebCodecs'
// ImageDecoder would give frames, but not in every browser this app supports,
// and not with the semantics that matter — which are the DESKTOP's.
//
// The desktop never decodes a GIF itself: it hands the file to Qt's
// QImageReader (glyphviz_gl/texture_manager.py, `_AnimatedGifEntry`), and every
// rule below is what Qt does, measured rather than read from the GIF89a prose —
// tools/dump_gif_frames.py runs the real reader over fixtures built for each
// rule, and src/io/gifFile.parity.test.ts diffs every pixel of every frame:
//
//   * The canvas is OPAQUE for the whole animation when the first frame has no
//     transparent index (Qt allocates Format_RGB32); only a first frame with one
//     gets an alpha channel (ARGB32). An opaque canvas then reads every
//     "transparent" fill as opaque white, which is visible and is Qt's answer.
//   * On the FIRST frame, transparent pixels are WRITTEN — as their own colour at
//     alpha 0 — rather than skipped; on every later frame they leave the pixel
//     below alone.
//   * A first frame smaller than the screen pads it with its transparent colour,
//     else with the background colour.
//   * Disposal 2 (restore background) fills with transparent white when the
//     DISPOSED frame has a transparent index, else with the background colour,
//     else with the canvas's first pixel. Disposal 3 restores what the frame
//     covered.
//   * A delay under 2 centiseconds is read as 10 (Qt's "Netscape" floor), so
//     0 and 1 cs both play at 100 ms. A frame with no Graphic Control Extension
//     keeps the previous frame's delay AND transparent index; only its disposal
//     resets.
//
// Then the desktop's own rule on top (`_MIN_GIF_FRAME_DELAY_MS`): no frame is
// held for less than 20 ms, and a late paint catches up whole frames.
//
// Pure — no DOM, no THREE — so it tests in plain node, like the CSV tokenizer
// and the zip reader, which made the same no-dependency call.

/** One image in the stream, still compressed. */
export interface GifFrame {
  left: number
  top: number
  width: number
  height: number
  interlaced: boolean
  /** The colour table this frame draws with: its local one, else the global. */
  palette: Uint8Array
  /** -1 for none. Carried over from the previous frame when this one has no GCE. */
  transparentIndex: number
  /** 0–3 (higher values behave as 0). Reset to 0 for a frame with no GCE. */
  disposal: number
  /** Qt's nextImageDelay(): centiseconds × 10, with its own < 2 cs → 10 cs floor. */
  delayMs: number
  minCodeSize: number
  /** The LZW payload, sub-blocks concatenated. */
  data: Uint8Array
}

export interface GifFile {
  width: number
  height: number
  /** Logical-screen background colour index, or -1 without a global table. */
  backgroundIndex: number
  globalPalette: Uint8Array | null
  frames: GifFrame[]
}

/** The desktop's floor on a frame's hold time, texture_manager.py. */
export const MIN_GIF_FRAME_DELAY_MS = 20

/** Q_TRANSPARENT: transparent WHITE, which is what an opaque canvas shows. */
const Q_TRANSPARENT = [255, 255, 255, 0] as const

/** True when `bytes` starts with a GIF signature. */
export function isGif(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
}

/**
 * Parse the container: logical screen, colour tables and each frame's control
 * values. The pixel data stays compressed until a frame is composited.
 */
export function parseGif(bytes: Uint8Array): GifFile {
  if (!isGif(bytes)) throw new Error('not a GIF file')
  let p = 6
  const u8 = () => {
    if (p >= bytes.length) throw new Error('the GIF ends early')
    return bytes[p++]
  }
  const u16 = () => u8() | (u8() << 8)
  const table = (sizeBits: number): Uint8Array => {
    const n = 3 * (1 << (sizeBits + 1))
    if (p + n > bytes.length) throw new Error('the GIF ends inside a colour table')
    const t = bytes.slice(p, p + n)
    p += n
    return t
  }
  const skipBlocks = () => {
    for (let n = u8(); n !== 0; n = u8()) p += n
  }

  const width = u16()
  const height = u16()
  const flags = u8()
  const background = u8()
  u8() // pixel aspect ratio
  const globalPalette = flags & 0x80 ? table(flags & 0x07) : null

  const frames: GifFrame[] = []
  // GCE state, which persists across a frame that does not restate it.
  let delayMs = 0
  let transparentIndex = -1
  let disposal = 0

  while (p < bytes.length) {
    const introducer = u8()
    if (introducer === 0x3b) break // trailer
    if (introducer === 0x21) {
      const label = u8()
      if (label === 0xf9) {
        const size = u8()
        const start = p
        const packed = u8()
        const cs = u16()
        const index = u8()
        p = start + size
        skipBlocks()
        disposal = (packed >> 2) & 0x07
        transparentIndex = packed & 0x01 ? index : -1
        delayMs = (cs < 2 ? 10 : cs) * 10
      } else {
        skipBlocks()
      }
      continue
    }
    if (introducer !== 0x2c) throw new Error(`unexpected block 0x${introducer.toString(16)}`)
    const left = u16()
    const top = u16()
    const w = u16()
    const h = u16()
    const imageFlags = u8()
    const local = imageFlags & 0x80 ? table(imageFlags & 0x07) : null
    const minCodeSize = u8()
    const chunks: Uint8Array[] = []
    let total = 0
    for (let n = u8(); n !== 0; n = u8()) {
      if (p + n > bytes.length) throw new Error('the GIF ends inside an image')
      chunks.push(bytes.subarray(p, p + n))
      total += n
      p += n
    }
    const data = new Uint8Array(total)
    let o = 0
    for (const c of chunks) {
      data.set(c, o)
      o += c.length
    }
    const palette = local ?? globalPalette
    if (!palette) throw new Error('a frame has no colour table')
    frames.push({
      left,
      top,
      width: w,
      height: h,
      interlaced: (imageFlags & 0x40) !== 0,
      palette,
      transparentIndex,
      disposal: disposal > 3 ? 0 : disposal,
      delayMs,
      minCodeSize,
      data,
    })
    // "disposal = NoDisposal; // Until an extension says otherwise." The delay
    // and transparent index are NOT reset (measured: no_gce, no_gce_after_…).
    disposal = 0
  }
  if (frames.length === 0) throw new Error('the GIF holds no images')
  return {
    width,
    height,
    backgroundIndex: globalPalette ? background : -1,
    globalPalette,
    frames,
  }
}

/**
 * Decompress one frame's colour indices, row-major in STORED order (interlaced
 * frames are reordered by the caller). Short or corrupt data leaves the rest
 * of the frame at index 0 rather than throwing, as decoders conventionally do.
 */
export function decodeLzw(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount)
  if (minCodeSize < 1 || minCodeSize > 11) return out
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const prefix = new Uint16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  for (let i = 0; i < clear; i++) suffix[i] = i

  let codeSize = minCodeSize + 1
  let codeMask = (1 << codeSize) - 1
  let avail = clear + 2
  let oldCode = -1
  let first = 0
  let datum = 0
  let bits = 0
  let pos = 0
  let n = 0

  while (n < pixelCount) {
    while (bits < codeSize) {
      if (pos >= data.length) return out
      datum |= data[pos++] << bits
      bits += 8
    }
    let code = datum & codeMask
    datum >>>= codeSize
    bits -= codeSize

    if (code === clear) {
      codeSize = minCodeSize + 1
      codeMask = (1 << codeSize) - 1
      avail = clear + 2
      oldCode = -1
      continue
    }
    if (code === eoi) break
    if (oldCode === -1) {
      if (code >= clear) return out // a stream must restart on a root code
      out[n++] = code
      oldCode = code
      first = code
      continue
    }

    const inCode = code
    let top = 0
    if (code >= avail) {
      // The KwKwK case: the code being defined by this very step.
      stack[top++] = first
      code = oldCode
    }
    while (code >= clear) {
      stack[top++] = suffix[code]
      code = prefix[code]
    }
    first = suffix[code]
    stack[top++] = first

    if (avail < 4096) {
      prefix[avail] = oldCode
      suffix[avail] = first
      avail++
      if ((avail & codeMask) === 0 && avail < 4096) {
        codeSize++
        codeMask += avail
      }
    }
    oldCode = inCode
    while (top > 0 && n < pixelCount) out[n++] = stack[--top]
  }
  return out
}

/** Stored row → displayed row, for the four GIF interlace passes. */
function interlaceRows(height: number): Int32Array {
  const rows = new Int32Array(height)
  let i = 0
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < height; y += step) rows[i++] = y
  }
  return rows
}

/**
 * Composites a GIF frame by frame onto its logical screen, exactly as Qt's
 * reader does — see the header for the rules. `rgba` is the current image,
 * row-major, TOP row first.
 */
export class GifCompositor {
  readonly gif: GifFile
  readonly rgba: Uint8Array
  /** Index of the frame `rgba` currently shows, or -1 before the first. */
  frame = -1
  /** Qt's RGB32 canvas: every pixel is opaque, whatever was written into it. */
  private readonly opaque: boolean
  /** What disposal 3 puts back, captured before the frame that asks for it. */
  private backing: Uint8Array | null = null

  constructor(gif: GifFile) {
    this.gif = gif
    this.rgba = new Uint8Array(gif.width * gif.height * 4)
    this.opaque = gif.frames[0].transparentIndex < 0
    this.reset()
  }

  /** Back to before the first frame — a reopened reader, the desktop's loop. */
  reset(): void {
    this.frame = -1
    this.backing = null
    // Qt memsets a fresh canvas to 0; an RGB32 one then reads as opaque black.
    this.rgba.fill(0)
    if (this.opaque) for (let i = 3; i < this.rgba.length; i += 4) this.rgba[i] = 255
  }

  /** Composite the next frame, wrapping to the first after the last. */
  next(): void {
    const frames = this.gif.frames
    if (this.frame + 1 >= frames.length) this.reset()
    if (this.frame >= 0) this.dispose(frames[this.frame])
    this.frame++
    this.draw(this.frame)
  }

  private put(o: number, r: number, g: number, b: number, a: number): void {
    const px = this.rgba
    px[o] = r
    px[o + 1] = g
    px[o + 2] = b
    px[o + 3] = this.opaque ? 255 : a
  }

  /** Qt's color(): the palette entry, at alpha 0 when it is the transparent one. */
  private color(index: number, palette: Uint8Array, transparent: number): readonly number[] {
    if (index * 3 + 2 >= palette.length) return Q_TRANSPARENT
    return [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2],
      index === transparent ? 0 : 255]
  }

  private fillRect(left: number, top: number, w: number, h: number, c: readonly number[]): void {
    const { width, height } = this.gif
    const x1 = Math.min(width, left + w)
    const y1 = Math.min(height, top + h)
    for (let y = Math.max(0, top); y < y1; y++) {
      for (let x = Math.max(0, left); x < x1; x++) this.put((y * width + x) * 4, c[0], c[1], c[2], c[3])
    }
  }

  private dispose(f: GifFrame): void {
    if (f.disposal === 2) {
      let c: readonly number[]
      if (f.transparentIndex >= 0) c = Q_TRANSPARENT
      else if (this.gif.backgroundIndex >= 0) c = this.color(this.gif.backgroundIndex, f.palette, -1)
      else c = [this.rgba[0], this.rgba[1], this.rgba[2], this.rgba[3]]
      this.fillRect(f.left, f.top, f.width, f.height, c)
    } else if (f.disposal === 3 && this.backing) {
      this.blitBacking(f)
    }
  }

  private blitBacking(f: GifFrame): void {
    const { width, height } = this.gif
    const backing = this.backing!
    const x0 = Math.max(0, f.left)
    const x1 = Math.min(width, f.left + f.width)
    for (let y = Math.max(0, f.top); y < Math.min(height, f.top + f.height); y++) {
      const dst = (y * width + x0) * 4
      this.rgba.set(backing.subarray(dst, dst + (x1 - x0) * 4), dst)
    }
  }

  private draw(i: number): void {
    const f = this.gif.frames[i]
    const { width, height, globalPalette, backgroundIndex } = this.gif
    if (f.disposal === 3) this.backing = this.rgba.slice()
    if (i === 0 && (f.left || f.top || f.width < width || f.height < height)) {
      // "Not full-size image - erase with bg or transparent." The colour table
      // is the global one: Qt fills before a local table has been read.
      const palette = globalPalette ?? f.palette
      if (f.transparentIndex >= 0) {
        this.fillRect(0, 0, width, height, this.color(f.transparentIndex, palette, f.transparentIndex))
      } else if (backgroundIndex >= 0) {
        this.fillRect(0, 0, width, height, this.color(backgroundIndex, palette, -1))
      }
    }

    const indices = decodeLzw(f.minCodeSize, f.data, f.width * f.height)
    const rows = f.interlaced ? interlaceRows(f.height) : null
    const transparent = f.transparentIndex
    for (let r = 0; r < f.height; r++) {
      const y = f.top + (rows ? rows[r] : r)
      if (y < 0 || y >= height) continue
      for (let c = 0; c < f.width; c++) {
        const x = f.left + c
        if (x >= width) break
        const index = indices[r * f.width + c]
        // Qt: `if (frame == 0 || code != trans_index)`.
        if (i !== 0 && index === transparent) continue
        const col = this.color(index, f.palette, transparent)
        this.put((y * width + x) * 4, col[0], col[1], col[2], col[3])
      }
    }
  }
}

/**
 * Plays a GIF on the desktop's clock (`_AnimatedGifEntry.advance`): each frame
 * is held for its own delay, never under 20 ms, looping forever, and a late
 * tick catches up whole frames rather than drifting.
 */
export class GifPlayer {
  readonly compositor: GifCompositor
  private elapsedMs = 0
  private holdMs: number

  constructor(gif: GifFile) {
    this.compositor = new GifCompositor(gif)
    this.compositor.next()
    this.holdMs = holdOf(gif.frames[0])
  }

  get frame(): number {
    return this.compositor.frame
  }

  /** The current image, top row first. */
  get rgba(): Uint8Array {
    return this.compositor.rgba
  }

  /** Step the clock; true when a different frame is now showing. */
  advance(dtMs: number): boolean {
    this.elapsedMs += dtMs
    let changed = false
    while (this.elapsedMs >= this.holdMs) {
      this.elapsedMs -= this.holdMs
      this.compositor.next()
      this.holdMs = holdOf(this.compositor.gif.frames[this.compositor.frame])
      changed = true
    }
    return changed
  }
}

function holdOf(frame: GifFrame): number {
  return Math.max(frame.delayMs, MIN_GIF_FRAME_DELAY_MS)
}
