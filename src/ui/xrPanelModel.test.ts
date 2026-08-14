import { describe, expect, it } from 'vitest'
import {
  ROW_CHANNELS,
  panelSignature,
  panelWidgets,
  sliderFraction,
  widgetAt,
  type XrPanelState,
} from './xrPanelModel'

const base: XrPanelState = {
  sceneName: 'topology_example_gv_node.csv',
  nodeCount: 109,
  drawnCount: 109,
  drawLimit: null,
  selection: null,
  channels: null,
  exampleName: 'Topology example',
}

const withChannels: XrPanelState = {
  ...base,
  channels: { frame: 12, frames: 512, playing: false },
}

describe('panelWidgets', () => {
  it('offers the viewer controls for any scene', () => {
    const ids = panelWidgets(base).map((w) => w.id)
    expect(ids).toEqual([
      'limit-down',
      'limit-up',
      'scene-prev',
      'scene-next',
      'fit-room',
      'fit-table',
    ])
  })

  it('adds the transport only when the scene has Channels', () => {
    const ids = panelWidgets(withChannels).map((w) => w.id)
    expect(ids.slice(0, 3)).toEqual(['stop', 'play', 'seek'])
  })

  it('shows a pause icon while playing and a play icon while stopped', () => {
    const paused = panelWidgets(withChannels).find((w) => w.id === 'play')
    const playing = panelWidgets({
      ...withChannels,
      channels: { frame: 12, frames: 512, playing: true },
    }).find((w) => w.id === 'play')
    expect(paused?.icon).toBe('play')
    expect(playing?.icon).toBe('pause')
  })

  it('leaves a margin at the bottom edge, so no button draws clipped', () => {
    for (const widget of panelWidgets(withChannels)) {
      expect(widget.rect.y + widget.rect.h).toBeLessThanOrEqual(0.98)
    }
  })

  it('keeps every widget inside the panel', () => {
    for (const widget of panelWidgets(withChannels)) {
      expect(widget.rect.x).toBeGreaterThanOrEqual(0)
      expect(widget.rect.y).toBeGreaterThanOrEqual(0)
      expect(widget.rect.x + widget.rect.w).toBeLessThanOrEqual(1)
      expect(widget.rect.y + widget.rect.h).toBeLessThanOrEqual(1)
    }
  })

  it('never overlaps two widgets', () => {
    const widgets = panelWidgets(withChannels)
    for (const a of widgets) {
      for (const b of widgets) {
        if (a === b) continue
        const apart =
          a.rect.x + a.rect.w <= b.rect.x ||
          b.rect.x + b.rect.w <= a.rect.x ||
          a.rect.y + a.rect.h <= b.rect.y ||
          b.rect.y + b.rect.h <= a.rect.y
        expect(apart).toBe(true)
      }
    }
  })
})

describe('widgetAt', () => {
  const widgets = panelWidgets(withChannels)

  it('finds a widget under a point inside it', () => {
    const play = widgets.find((w) => w.id === 'play')!
    const u = play.rect.x + play.rect.w / 2
    const v = play.rect.y + play.rect.h / 2
    expect(widgetAt(widgets, u, v)?.id).toBe('play')
  })

  it('misses the gaps between rows', () => {
    expect(widgetAt(widgets, 0.5, ROW_CHANNELS - 0.02)).toBeNull()
  })

  it('misses the header and the selection readout', () => {
    expect(widgetAt(widgets, 0.5, 0.05)).toBeNull()
    expect(widgetAt(widgets, 0.5, 0.22)).toBeNull()
  })

  it('hits on the boundary, so an edge press is not lost', () => {
    const stop = widgets.find((w) => w.id === 'stop')!
    expect(widgetAt(widgets, stop.rect.x, stop.rect.y)?.id).toBe('stop')
  })
})

describe('sliderFraction', () => {
  const seek = panelWidgets(withChannels).find((w) => w.id === 'seek')!.rect

  it('reads 0 at the left edge and 1 at the right', () => {
    expect(sliderFraction(seek, seek.x)).toBe(0)
    expect(sliderFraction(seek, seek.x + seek.w)).toBeCloseTo(1, 12)
  })

  it('reads the midpoint', () => {
    expect(sliderFraction(seek, seek.x + seek.w / 2)).toBeCloseTo(0.5, 12)
  })

  it('clamps a drag that runs off either end', () => {
    expect(sliderFraction(seek, -5)).toBe(0)
    expect(sliderFraction(seek, 5)).toBe(1)
  })
})

describe('panelSignature', () => {
  it('changes when anything drawn changes', () => {
    const start = panelSignature(withChannels, null)
    expect(panelSignature(withChannels, null)).toBe(start)
    expect(panelSignature({ ...withChannels, drawnCount: 50 }, null)).not.toBe(start)
    expect(panelSignature(withChannels, 'play')).not.toBe(start)
    expect(
      panelSignature({ ...withChannels, channels: { frame: 13, frames: 512, playing: false } }, null),
    ).not.toBe(start)
    expect(
      panelSignature({ ...withChannels, selection: { id: 4, text: 'Rod', type: 'Glyph' } }, null),
    ).not.toBe(start)
  })
})
