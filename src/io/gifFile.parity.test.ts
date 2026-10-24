// Animated GIF parity: this app's decoder against the reader desktop GlyphViz
// actually plays GIFs through — Qt's QImageReader, run by
// tools/dump_gif_frames.py over fixtures that tool writes, one rule each.
//
// Every frame is diffed EXACTLY, pixel by pixel and channel by channel: a GIF
// is palette indices, so there is no rounding anywhere for a tolerance to
// absorb, and the rules worth pinning (what disposal fills with, what an opaque
// canvas does to a transparent fill) are precisely single-pixel facts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GifCompositor, GifPlayer, MIN_GIF_FRAME_DELAY_MS, parseGif } from './gifFile'

interface DumpFrame {
  delay: number
  width: number
  height: number
  rgba: string
}

interface DumpCase {
  about: string
  image_count: number
  frames: DumpFrame[]
}

const here = new URL('./fixtures/gif/', import.meta.url)
const dump = JSON.parse(readFileSync(new URL('gif_frames.json', here), 'utf8')) as Record<
  string,
  DumpCase
>

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

const bytesOf = (name: string) => new Uint8Array(readFileSync(new URL(`${name}.gif`, here)))

/** First differing pixel, for a failure message that says where. */
function firstDifference(actual: Uint8Array, expected: Uint8Array, width: number): string | null {
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      const p = Math.floor(i / 4)
      const at = (b: Uint8Array) => [...b.subarray(p * 4, p * 4 + 4)].join(',')
      return `pixel (${p % width}, ${Math.floor(p / width)}): got ${at(actual)}, Qt ${at(expected)}`
    }
  }
  return null
}

describe('GIF decoding matches the desktop reader (Qt QImageReader)', () => {
  for (const [name, expected] of Object.entries(dump)) {
    it(`${name} — ${expected.about}`, () => {
      const gif = parseGif(bytesOf(name))
      expect(gif.frames.length).toBe(expected.image_count)
      const compositor = new GifCompositor(gif)
      expected.frames.forEach((frame, i) => {
        compositor.next()
        expect(gif.frames[i].delayMs, `frame ${i} delay`).toBe(frame.delay)
        expect([gif.width, gif.height]).toEqual([frame.width, frame.height])
        const want = fromBase64(frame.rgba)
        expect(firstDifference(compositor.rgba, want, frame.width), `frame ${i}`).toBeNull()
      })
    })
  }

  it('starts the loop over from a fresh canvas, as the desktop reopens its reader', () => {
    // restore_previous ends with a frame that is NOT the first one's image, so
    // wrapping without a reset would show the wrong picture.
    const gif = parseGif(bytesOf('restore_previous'))
    const compositor = new GifCompositor(gif)
    for (let i = 0; i < gif.frames.length; i++) compositor.next()
    compositor.next()
    const first = fromBase64(dump.restore_previous.frames[0].rgba)
    expect(compositor.frame).toBe(0)
    expect(firstDifference(compositor.rgba, first, gif.width)).toBeNull()
  })
})

describe('GifPlayer — the desktop clock (_AnimatedGifEntry.advance)', () => {
  it('holds each frame for its own delay', () => {
    const player = new GifPlayer(parseGif(bytesOf('basic'))) // 100, 200, 300 ms
    expect(player.frame).toBe(0)
    expect(player.advance(99)).toBe(false)
    expect(player.advance(1)).toBe(true)
    expect(player.frame).toBe(1)
    expect(player.advance(199)).toBe(false)
    expect(player.advance(1)).toBe(true)
    expect(player.frame).toBe(2)
    expect(player.advance(300)).toBe(true)
    expect(player.frame).toBe(0) // loops forever
  })

  it('catches up whole frames after a late tick instead of drifting', () => {
    const player = new GifPlayer(parseGif(bytesOf('basic')))
    expect(player.advance(350)).toBe(true) // 100 + 200 elapsed, 50 into frame 2
    expect(player.frame).toBe(2)
    expect(player.advance(249)).toBe(false)
    expect(player.advance(1)).toBe(true)
    expect(player.frame).toBe(0)
  })

  it('never holds a frame for less than 20 ms', () => {
    // Qt itself never reports under 20 for a real file (short_delays: 2 cs is
    // its floor-free minimum), so the clamp is checked on a frame the parser
    // could only produce from a hand-edited delay.
    const gif = parseGif(bytesOf('short_delays'))
    gif.frames[0].delayMs = 0
    const player = new GifPlayer(gif)
    expect(player.advance(MIN_GIF_FRAME_DELAY_MS - 1)).toBe(false)
    expect(player.advance(1)).toBe(true)
  })
})
