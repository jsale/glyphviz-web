import { describe, expect, it } from 'vitest'
import {
  channelBindingMessage,
  channelIdsHint,
  channelInHint,
  channelOptionLabel,
} from './channelIn'

describe('channelIdsHint', () => {
  it('gives a range when the ids run contiguously', () => {
    // The usual generated case — 64 channels named 1..64 want four characters,
    // not a list.
    expect(channelIdsHint([1, 2, 3, 4, 5])).toBe('1–5')
  })

  it('lists sparse ids', () => {
    expect(channelIdsHint([3, 7])).toBe('3, 7')
  })

  it('counts the rest past six', () => {
    expect(channelIdsHint([1, 2, 3, 4, 5, 6, 8, 9])).toBe('1, 2, 3, 4, 5, 6, +2 more')
  })

  it('is empty with no channels, and never a range for one', () => {
    expect(channelIdsHint([])).toBe('')
    expect(channelIdsHint([5])).toBe('5')
  })
})

describe('channelInHint', () => {
  const state = (over: Partial<Parameters<typeof channelInHint>[0]> = {}) => ({
    channelIds: [3, 7],
    value: 0,
    mixed: false,
    attributes: [],
    ...over,
  })

  it('says so when there is no channel file at all', () => {
    // The id is still node data that saves, so the row stays usable.
    expect(channelInHint(state({ channelIds: [], value: 4 }))).toBe('no channel file loaded')
  })

  it('names what is available when the node is unbound', () => {
    expect(channelInHint(state())).toBe('not animated — 2 channels available (3, 7)')
  })

  it('names what the chosen channel drives', () => {
    expect(channelInHint(state({ value: 3, attributes: ['translate_z', 'color_r'] }))).toBe(
      'drives translate_z, color_r',
    )
  })

  it('is honest about a channel that maps nothing bindable', () => {
    expect(channelInHint(state({ value: 3 }))).toBe('drives nothing GlyphViz can bind')
  })

  it('reports an id this file does not have, without pretending it is bound', () => {
    expect(channelInHint(state({ value: 99 }))).toBe('no channel 99 in this file (3, 7)')
  })

  it('flags a selection that does not agree, in every state', () => {
    expect(channelInHint(state({ mixed: true }))).toContain('(selection differs)')
    expect(channelInHint(state({ value: 3, mixed: true }))).toContain('(selection differs)')
    expect(channelInHint(state({ channelIds: [], mixed: true }))).toContain('(selection differs)')
  })
})

describe('channelOptionLabel', () => {
  it('names the channel by what it drives', () => {
    expect(channelOptionLabel(3, ['translate_z', 'color_r'])).toBe('3 · translate_z, color_r')
  })

  it('spells out 0 rather than leaving a bare number to be guessed at', () => {
    expect(channelOptionLabel(0, [])).toBe('none (0)')
  })

  it('says when a channel exists but drives nothing this app can bind', () => {
    expect(channelOptionLabel(5, [])).toBe('5 · (no bindable attribute)')
  })
})

describe('channelBindingMessage', () => {
  it('reports a cleared binding as a return to saved values', () => {
    expect(channelBindingMessage('Node 1', { channelIds: [3], value: 0, mixed: false, attributes: [] })).toBe(
      'Node 1: channel binding cleared — back to saved values.',
    )
  })

  it('records an id with no channel file, saying nothing animates yet', () => {
    expect(
      channelBindingMessage('3 nodes', { channelIds: [], value: 4, mixed: false, attributes: [] }),
    ).toContain('the id saves with the scene')
  })

  it('names the attributes a real binding drives', () => {
    expect(
      channelBindingMessage('Node 1', {
        channelIds: [3],
        value: 3,
        mixed: false,
        attributes: ['scale_x'],
      }),
    ).toBe('Node 1: bound to channel 3 — driving scale_x.')
  })

  it('says which ids the scene does have when the id is not one of them', () => {
    expect(
      channelBindingMessage('Node 1', { channelIds: [3, 7], value: 99, mixed: false, attributes: [] }),
    ).toBe("Node 1: channel 99 is not in this scene's ch-map (it has 3, 7).")
  })
})
