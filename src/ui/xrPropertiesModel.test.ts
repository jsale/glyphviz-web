import { describe, expect, it } from 'vitest'
import { blankNode, NEW_OBJECT_DEFAULTS } from '../gv/createNode'
import type { GvNode } from '../gv/types'
import { GEOMETRY_NAMES, Geometry, NodeType, Topo } from '../gv/types'
import {
  DEFAULT_STEP,
  STEP_LADDER,
  num,
  propLayout,
  propSignature,
  rowY,
  scrubNotches,
  stepSize,
  type XrPropId,
  type XrPropState,
} from './xrPropertiesModel'
import { widgetAt } from './xrWidget'

function node(overrides: Partial<GvNode> = {}): GvNode {
  return Object.assign(blankNode(42, NEW_OBJECT_DEFAULTS), overrides)
}

function state(overrides: Partial<XrPropState> = {}): XrPropState {
  return {
    node: node(),
    count: 1,
    page: 'shape',
    axis: 'x',
    step: DEFAULT_STEP,
    pinned: false,
    labels: { textureLabel: 'none' },
    ...overrides,
  }
}

function ids(s: XrPropState): XrPropId[] {
  return propLayout(s).widgets.map((w) => w.id)
}

describe('propLayout — chrome that every state carries', () => {
  it('offers the pin even with nothing selected, so a parked slab can be recalled', () => {
    const layout = propLayout(state({ node: null, count: 0 }))
    expect(layout.empty).not.toBeNull()
    expect(layout.widgets.map((w) => w.id)).toEqual(['pin'])
  })

  it('labels the pin by what pressing it does', () => {
    const pinOf = (pinned: boolean) =>
      propLayout(state({ pinned })).widgets.find((w) => w.id === 'pin')!
    expect(pinOf(false).label).toBe('pin')
    expect(pinOf(false).active).toBe(false)
    expect(pinOf(true).label).toBe('dock')
    expect(pinOf(true).active).toBe(true)
  })

  it('marks the open page and no other', () => {
    for (const page of ['shape', 'move', 'look'] as const) {
      const tabs = propLayout(state({ page })).widgets.filter((w) => w.id.startsWith('page-'))
      expect(tabs.filter((t) => t.active).map((t) => t.id)).toEqual([`page-${page}`])
    }
  })
})

describe('propLayout — geometry of the quad', () => {
  const everyState: XrPropState[] = [
    state({ page: 'shape' }),
    state({ page: 'move' }),
    state({ page: 'look' }),
    state({ node: null, count: 0 }),
    state({ page: 'shape', node: node({ type: NodeType.WorldGrid }) }),
  ]

  it('keeps every widget inside the panel', () => {
    for (const s of everyState) {
      for (const widget of propLayout(s).widgets) {
        expect(widget.rect.x).toBeGreaterThanOrEqual(0)
        expect(widget.rect.y).toBeGreaterThanOrEqual(0)
        expect(widget.rect.x + widget.rect.w).toBeLessThanOrEqual(1)
        expect(widget.rect.y + widget.rect.h).toBeLessThanOrEqual(1)
      }
    }
  })

  it('leaves a margin at the bottom edge, so no widget draws clipped', () => {
    // The control panel's own lesson — a button flush with the rounded corner
    // renders cut off, which reads as a rendering fault.
    for (const s of everyState) {
      for (const widget of propLayout(s).widgets) {
        expect(widget.rect.y + widget.rect.h).toBeLessThanOrEqual(0.97)
      }
    }
  })

  it('never overlaps two widgets', () => {
    for (const s of everyState) {
      const widgets = propLayout(s).widgets
      for (const a of widgets) {
        for (const b of widgets) {
          if (a === b) continue
          const apart =
            a.rect.x + a.rect.w <= b.rect.x ||
            b.rect.x + b.rect.w <= a.rect.x ||
            a.rect.y + a.rect.h <= b.rect.y ||
            b.rect.y + b.rect.h <= a.rect.y
          expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
        }
      }
    }
  })

  it('gives every row a hittable height — a ray has about a degree of jitter', () => {
    for (const s of everyState) {
      for (const widget of propLayout(s).widgets) {
        expect(widget.rect.h).toBeGreaterThanOrEqual(0.1)
        expect(widget.rect.w).toBeGreaterThanOrEqual(0.1)
      }
    }
  })
})

describe('propLayout — the Shape page', () => {
  it('offers the enum steppers, ratio and texture', () => {
    expect(ids(state({ page: 'shape' }))).toEqual([
      'pin',
      'page-shape',
      'page-move',
      'page-look',
      'topo-prev',
      'topo-next',
      'geometry-prev',
      'geometry-next',
      'ratio-dec',
      'ratio-scrub',
      'ratio-inc',
      'facet-prev',
      'facet-next',
      'texture-prev',
      'texture-next',
    ])
  })

  it('shows the NAME, not the id — the value column has no room for both', () => {
    const layout = propLayout(
      state({ page: 'shape', node: node({ topo: Topo.Sphere, geometry: Geometry.CubeSolid }) }),
    )
    const value = (caption: string) => layout.rows.find((r) => r.caption === caption)?.value
    expect(value('topo')).toBe('Sphere (KML)')
    expect(value('geometry')).toBe(GEOMETRY_NAMES[Geometry.CubeSolid])
    // Specifically NOT "Sphere (KML) (7)" — the DOM inspector appends the id,
    // and 40% of a 26 cm quad has no room for both.
    expect(value('topo')).not.toContain('(7)')
  })

  it('reads facet 1-based, as every other surface in the app does', () => {
    const layout = propLayout(state({ page: 'shape', node: node({ subspace: 0 }) }))
    expect(layout.rows.find((r) => r.caption === 'facet')?.value).toBe('1')
    const fifth = propLayout(state({ page: 'shape', node: node({ subspace: 4 }) }))
    expect(fifth.rows.find((r) => r.caption === 'facet')?.value).toBe('5')
  })

  it('greys the shape steppers on the types J and O never touch', () => {
    for (const type of [NodeType.World, NodeType.Camera, NodeType.WorldGrid]) {
      const widgets = propLayout(state({ page: 'shape', node: node({ type }) })).widgets
      const frozen = widgets.filter((w) => w.id.startsWith('topo-') || w.id.startsWith('geometry-'))
      expect(frozen).toHaveLength(4)
      expect(frozen.every((w) => w.disabled)).toBe(true)
      // The rows stay PRESENT, so the page does not change shape under the
      // pointer when the selection moves onto a grid.
      expect(widgets.some((w) => w.id === 'texture-next' && !w.disabled)).toBe(true)
    }
  })

  it('leaves an ordinary glyph’s steppers live', () => {
    const widgets = propLayout(state({ page: 'shape' })).widgets
    expect(widgets.filter((w) => w.disabled)).toHaveLength(0)
  })
})

describe('propLayout — the Move page', () => {
  it('offers one axis chip set and one step chip for all three vectors', () => {
    expect(ids(state({ page: 'move' }))).toEqual([
      'pin',
      'page-shape',
      'page-move',
      'page-look',
      'axis-x',
      'axis-y',
      'axis-z',
      'step-down',
      'step-up',
      'translate-dec',
      'translate-scrub',
      'translate-inc',
      'rotate-dec',
      'rotate-scrub',
      'rotate-inc',
      'scale-dec',
      'scale-scrub',
      'scale-inc',
    ])
  })

  it('shows the chosen axis of each vector, and marks which one that is', () => {
    const n = node({
      translate: { x: 1, y: 2, z: 3 },
      rotate: { x: 10, y: 20, z: 30 },
      scale: { x: 4, y: 5, z: 6 },
    })
    for (const [axis, t, r, s] of [
      ['x', '1', '10', '4'],
      ['y', '2', '20', '5'],
      ['z', '3', '30', '6'],
    ] as const) {
      const layout = propLayout(state({ page: 'move', axis, node: n }))
      const value = (caption: string) => layout.rows.find((r2) => r2.caption === caption)?.value
      expect(value('translate')).toBe(t)
      expect(value('rotate')).toBe(r)
      expect(value('scale')).toBe(s)
      const chips = layout.widgets.filter((w) => w.id.startsWith('axis-'))
      expect(chips.filter((c) => c.active).map((c) => c.id)).toEqual([`axis-${axis}`])
    }
  })

  it('greys the step chip at each end of the ladder rather than wrapping', () => {
    // A step that wrapped from 100 back to 0.01 would silently turn a coarse
    // drag into a hair-fine one; the ends are meant to be felt.
    const ends = (step: number) => {
      const w = propLayout(state({ page: 'move', step })).widgets
      return [
        w.find((x) => x.id === 'step-down')?.disabled ?? false,
        w.find((x) => x.id === 'step-up')?.disabled ?? false,
      ]
    }
    expect(ends(0)).toEqual([true, false])
    expect(ends(DEFAULT_STEP)).toEqual([false, false])
    expect(ends(STEP_LADDER.length - 1)).toEqual([false, true])
  })
})

describe('propLayout — the Look page', () => {
  it('offers the palette pair, alpha and the two flags', () => {
    expect(ids(state({ page: 'look' }))).toEqual([
      'pin',
      'page-shape',
      'page-move',
      'page-look',
      'palette-prev',
      'palette-next',
      'index-prev',
      'index-next',
      'alpha-dec',
      'alpha-scrub',
      'alpha-inc',
      'hide',
      'showtext',
    ])
  })

  it('shows the index against its own palette’s range', () => {
    // Palette 0 has 20 literal colours; 2 is a 128-step gradient. An index row
    // that did not say which would be unreadable.
    const of = (paletteId: number, colorIndex: number) =>
      propLayout(state({ page: 'look', node: node({ paletteId, colorIndex }) })).rows.find(
        (r) => r.caption === 'index',
      )?.value
    expect(of(0, 3)).toBe('3 / 19')
    expect(of(2, 3)).toBe('3 / 127')
  })

  it('reflects the two flags', () => {
    const flags = (hide: number, showText: number) => {
      const w = propLayout(state({ page: 'look', node: node({ hide, showText }) })).widgets
      return [w.find((x) => x.id === 'hide')?.checked, w.find((x) => x.id === 'showtext')?.checked]
    }
    expect(flags(0, 0)).toEqual([false, false])
    expect(flags(1, 1)).toEqual([true, true])
  })

  it('carries the literal colour to the header swatch', () => {
    const layout = propLayout(state({ node: node({ color: { r: 220, g: 20, b: 60, a: 255 } }) }))
    expect(layout.color).toEqual({ r: 220, g: 20, b: 60, a: 255 })
  })
})

describe('propLayout — the header', () => {
  it('names the node and its tag text when it has one', () => {
    const layout = propLayout(state({ node: node({ id: 7, text: 'Reactor core' }) }))
    expect(layout.title).toBe('#7  Glyph')
    expect(layout.subtitle).toBe('Reactor core')
  })

  it('falls back to the structural numbers when it has none', () => {
    const layout = propLayout(state({ node: node({ id: 7, parentId: 3, branchLevel: 2 }) }))
    expect(layout.subtitle).toBe('Glyph · parent 3 · level 2')
  })

  it('says how many are selected, since every edit applies to all of them', () => {
    expect(propLayout(state({ count: 5, node: node({ id: 7 }) })).title).toBe('5 nodes · #7')
  })
})

describe('widgetAt', () => {
  const widgets = propLayout(state({ page: 'move' })).widgets

  it('finds the widget under a point inside it', () => {
    const inc = widgets.find((w) => w.id === 'translate-inc')!
    const u = inc.rect.x + inc.rect.w / 2
    const v = inc.rect.y + inc.rect.h / 2
    expect(widgetAt(widgets, u, v)?.id).toBe('translate-inc')
  })

  it('misses the header and the caption column', () => {
    expect(widgetAt(widgets, 0.5, 0.06)).toBeNull()
    expect(widgetAt(widgets, 0.05, rowY(1) + 0.05)).toBeNull()
  })

  it('hits on the boundary, so an edge press is not lost', () => {
    const dec = widgets.find((w) => w.id === 'scale-dec')!
    expect(widgetAt(widgets, dec.rect.x, dec.rect.y)?.id).toBe('scale-dec')
  })
})

describe('num', () => {
  it('never uses exponent form — a value you cannot read is one you cannot undo', () => {
    expect(num(0.0000001)).toBe('0')
    expect(num(123456)).toBe('123456')
  })

  it('drops trailing zeros and scales its precision to the magnitude', () => {
    expect(num(0)).toBe('0')
    expect(num(1)).toBe('1')
    expect(num(0.125)).toBe('0.125')
    expect(num(3.14159)).toBe('3.14')
    expect(num(1234.56789)).toBe('1234.6')
    expect(num(-2.5)).toBe('-2.5')
  })
})

describe('stepSize', () => {
  it('walks the ladder and clamps at both ends', () => {
    expect(stepSize(0)).toBe(0.01)
    expect(stepSize(DEFAULT_STEP)).toBe(1)
    expect(stepSize(STEP_LADDER.length - 1)).toBe(100)
    expect(stepSize(-5)).toBe(0.01)
    expect(stepSize(99)).toBe(100)
  })
})

describe('scrubNotches', () => {
  it('quantises, so a dragged value lands on multiples of the step', () => {
    // 40 notches across the full width: a quarter of the panel is 10 steps.
    expect(scrubNotches(0.5, 0.5)).toBe(0)
    expect(scrubNotches(0.5, 0.75)).toBe(10)
    expect(scrubNotches(0.5, 0.25)).toBe(-10)
  })

  it('holds at zero inside half a notch, and moves past it', () => {
    // The dead band is what stops a hand's own tremor walking the value while
    // the trigger is held still.
    expect(scrubNotches(0.5, 0.5 + 1 / 200)).toBe(0)
    expect(scrubNotches(0.5, 0.5 + 1 / 60)).toBe(1)
    expect(scrubNotches(0.5, 0.5 - 1 / 60)).toBe(-1)
  })

  it('is monotone across a sweep, so a drag never runs backwards', () => {
    let previous = -Infinity
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const notches = scrubNotches(0, u)
      expect(notches).toBeGreaterThanOrEqual(previous)
      previous = notches
    }
  })
})

describe('propSignature', () => {
  const base = state()

  it('changes when any drawn value changes', () => {
    const sig = (s: XrPropState, hovered: string | null = null) =>
      propSignature(propLayout(s), hovered)
    const start = sig(base)
    expect(sig(base)).toBe(start)
    expect(sig(state({ node: node({ ratio: 0.5 }) }))).not.toBe(start)
    expect(sig(state({ page: 'move' }))).not.toBe(start)
    expect(sig(state({ pinned: true }))).not.toBe(start)
    expect(sig(state({ count: 3 }))).not.toBe(start)
    expect(sig(state({ labels: { textureLabel: '2 · sky.png' } }))).not.toBe(start)
    expect(sig(base, 'topo-next')).not.toBe(start)
  })

  it('changes when only the colour changes — the swatch is part of the picture', () => {
    const a = propSignature(propLayout(base), null)
    const b = propSignature(
      propLayout(state({ node: node({ color: { r: 1, g: 2, b: 3, a: 255 } }) })),
      null,
    )
    expect(a).not.toBe(b)
  })

  it('holds still while an untouched field is re-read, so a still panel is free', () => {
    const n = node()
    expect(propSignature(propLayout(state({ node: n })), null)).toBe(
      propSignature(propLayout(state({ node: n })), null),
    )
  })
})
