// Tag text font size — the World-row setting, the CSV column and the clamp.
// The web half of desktop tests/test_tag_font_size.py.
//
// Three things are pinned here:
//
//   * The DEFAULT is what a file with no tag_font_size column loads as, so
//     raising it is what makes every existing scene's labels bigger. It is
//     also what keeps those files column-stable through a load/save round trip
//     — the column is only written when someone actually changed the size.
//   * The overlay reads the size off the World row (type 0), like the tag
//     colours, and clamps it — a Channels track or a hand-edited CSV can put
//     any number in the field.
//   * The point size reaches the canvas font string the paint pass uses, so
//     the setting is pinned to what is drawn and not only to a number moving
//     between objects. (Real painted ink is measured in the browser drive; a
//     node test has no text metrics.)

import { describe, expect, it } from 'vitest'
import { createRootNode, createWorldNode } from './createNode'
import { parseGvNodeCsv, REQUIRED_COLUMNS } from './nodeCsv'
import { writeGvNodeCsv } from './writeNodeCsv'
import { clampTagFontSize, tagTextStyle } from './worldNode'
import type { GvNode } from './types'
import {
  NodeType,
  TAG_DEFAULT_FONT_SIZE,
  TAG_FONT_SIZE_MAX,
  TAG_FONT_SIZE_MIN,
} from './types'
import { tagFontCss } from '../render/labelOverlay'
import topologyNodeCsv from './fixtures/topology_example_gv_node.csv?raw'

function node(overrides: Partial<GvNode> = {}): GvNode {
  return Object.assign(createRootNode([]), overrides)
}

function world(tagFontSize?: number): GvNode {
  const w = createWorldNode([])
  if (tagFontSize !== undefined) w.tagFontSize = tagFontSize
  return w
}

/** Just the 20 required columns and one glyph row — no optional columns. */
const MINIMAL_CSV = `${REQUIRED_COLUMNS.join(',')}\n1,5,0,0,0,0,0,0,0,0,1,1,1,255,0,0,255,3,0,1\n`

describe('the default', () => {
  it('is larger than the 9 pt labels were hardcoded to, and inside the range', () => {
    // The whole point of the setting having a default at all: labels used to
    // paint at a fixed 9 pt, which read too small at a working camera distance.
    expect(TAG_DEFAULT_FONT_SIZE).toBeGreaterThan(9)
    expect(TAG_FONT_SIZE_MIN).toBeLessThan(TAG_DEFAULT_FONT_SIZE)
    expect(TAG_DEFAULT_FONT_SIZE).toBeLessThan(TAG_FONT_SIZE_MAX)
  })

  it('is what a fresh node carries', () => {
    expect(node().tagFontSize).toBe(TAG_DEFAULT_FONT_SIZE)
    expect(world().tagFontSize).toBe(TAG_DEFAULT_FONT_SIZE)
  })
})

describe('the CSV column', () => {
  it('loads as the default when the file has no such column', () => {
    const parsed = parseGvNodeCsv(MINIMAL_CSV)
    expect(parsed.errors).toEqual([])
    expect(parsed.nodes.map((n) => n.tagFontSize)).toEqual([TAG_DEFAULT_FONT_SIZE])
  })

  it('is not written while every row is at the default', () => {
    const csv = writeGvNodeCsv([world(), node({ id: 2 })])
    expect(csv.split('\r\n')[0]).not.toContain('tag_font_size')
  })

  it('round-trips a size someone chose', () => {
    const csv = writeGvNodeCsv([world(22), node({ id: 2 })])
    expect(csv.split('\r\n')[0]).toContain('tag_font_size')

    const back = parseGvNodeCsv(csv)
    expect(back.errors).toEqual([])
    expect(back.nodes[0].tagFontSize).toBe(22)
    // Only the World row carries the setting; the rest stay at the default,
    // which is what the overlay falls back to if the World row goes away.
    expect(back.nodes[1].tagFontSize).toBe(TAG_DEFAULT_FONT_SIZE)
  })

  it('leaves a real example scene column-stable through load → save', () => {
    // Guards the shipped example scenes: none of them sets a size, so none of
    // them should grow a column when re-saved.
    const parsed = parseGvNodeCsv(topologyNodeCsv)
    expect(parsed.errors).toEqual([])
    expect(parsed.nodes.every((n) => n.tagFontSize === TAG_DEFAULT_FONT_SIZE)).toBe(true)
    const resaved = writeGvNodeCsv(parsed.nodes, { inlineLabels: parsed.hasInlineLabelColumns })
    expect(resaved.split('\r\n')[0]).not.toContain('tag_font_size')
  })
})

describe('the size the overlay paints at', () => {
  it('falls back to the default for a scene with no World row', () => {
    expect(tagTextStyle([node()]).fontSize).toBe(TAG_DEFAULT_FONT_SIZE)
  })

  it('reads the World row', () => {
    expect(tagTextStyle([world(20), node({ id: 2 })]).fontSize).toBe(20)
  })

  it('clamps what a track or a hand-edited CSV can put in the field', () => {
    // The desktop's Viewport._tag_font_size clamp, at this app's read point.
    expect(tagTextStyle([world(0)]).fontSize).toBe(TAG_FONT_SIZE_MIN)
    expect(tagTextStyle([world(-4)]).fontSize).toBe(TAG_FONT_SIZE_MIN)
    expect(tagTextStyle([world(500)]).fontSize).toBe(TAG_FONT_SIZE_MAX)
    // A non-integer would draw at a size no slider position reproduces.
    expect(clampTagFontSize(13.7)).toBe(13)
    expect(clampTagFontSize(Number.NaN)).toBe(TAG_DEFAULT_FONT_SIZE)
  })

  it('takes the LOWEST-id World row, like every other scene setting', () => {
    const nodes = [world(30), world(9)]
    nodes[0].id = 7
    nodes[1].id = 3
    nodes[1].type = NodeType.World
    expect(tagTextStyle(nodes).fontSize).toBe(9)
  })

  it('reaches the canvas font the paint pass uses', () => {
    // Qt sizes in points and canvas in px; the old hardcoded 12px WAS the
    // desktop's 9 pt at that ratio, which is what keeps the two apps' labels
    // the same size at the same setting.
    expect(tagFontCss(9)).toContain('12px')
    const px = (pt: number) => Number(tagFontCss(pt).split('px')[0])
    expect(px(TAG_FONT_SIZE_MIN)).toBeLessThan(px(TAG_DEFAULT_FONT_SIZE))
    expect(px(TAG_DEFAULT_FONT_SIZE)).toBeLessThan(px(TAG_FONT_SIZE_MAX))
    // Every step of the slider has to be a distinct size, or the middle of the
    // range would move in visible jumps.
    const sizes = new Set<number>()
    for (let pt = TAG_FONT_SIZE_MIN; pt <= TAG_FONT_SIZE_MAX; pt++) sizes.add(px(pt))
    expect(sizes.size).toBe(TAG_FONT_SIZE_MAX - TAG_FONT_SIZE_MIN + 1)
  })
})
