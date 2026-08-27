import { describe, expect, it } from 'vitest'
import { blankNode, NEW_OBJECT_DEFAULTS } from '../gv/createNode'
import { CRITERION_LABELS } from '../gv/selectionOps'
import type { GvNode } from '../gv/types'
import { GEOMETRY_NAMES, Geometry, NodeType, Topo } from '../gv/types'
import {
  CONTENT_X,
  DEFAULT_STEP,
  DRAW_SPACING_DEFAULT,
  MAX_ROWS,
  PAGES,
  PANEL_H_M,
  PANEL_W_M,
  STEP_LADDER,
  cx,
  isPageWidget,
  num,
  propLayout,
  propSignature,
  rowY,
  scrubNotches,
  stepSize,
  type XrDrawData,
  type XrPropId,
  type XrPropState,
} from './xrPropertiesModel'
import { widgetAt } from './xrWidget'

function node(overrides: Partial<GvNode> = {}): GvNode {
  return Object.assign(blankNode(42, NEW_OBJECT_DEFAULTS), overrides)
}

const SELECT_VALUES = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
]

const DRAW: XrDrawData = {
  drawing: false,
  gridId: 7,
  gridIsGlobe: false,
  brushes: ['Single Object'],
  brushIndex: 0,
  drawZ: 0,
  spacing: DRAW_SPACING_DEFAULT,
  headingJitter: 0,
  scaleJitter: 0,
  stamps: 0,
  nodes: 0,
}

function draw(overrides: Partial<XrDrawData> = {}): XrDrawData {
  return { ...DRAW, ...overrides }
}

function state(overrides: Partial<XrPropState> = {}): XrPropState {
  return {
    node: node(),
    count: 1,
    page: 'shape',
    axis: 'x',
    step: DEFAULT_STEP,
    pinned: false,
    grabMode: 'move',
    labels: { textureLabel: 'none' },
    select: { criterion: 'branchLevel', values: SELECT_VALUES, selectable: 109 },
    draw: DRAW,
    valueIndex: 0,
    addToSelection: false,
    ...overrides,
  }
}

function ids(s: XrPropState): XrPropId[] {
  return propLayout(s).widgets.map((w) => w.id)
}

describe('propLayout — chrome that every state carries', () => {
  it('offers the pin and the tabs with nothing selected', () => {
    const layout = propLayout(state({ node: null, count: 0 }))
    expect(layout.empty).not.toBeNull()
    expect(layout.widgets.map((w) => w.id)).toEqual([
      'pin',
      'page-select',
      'page-shape',
      'page-move',
      'page-look',
      'page-draw',
    ])
  })

  it('points an empty Properties page at the Select tab rather than a dead end', () => {
    expect(propLayout(state({ node: null, count: 0 })).empty).toContain('Select tab')
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
    for (const page of ['select', 'shape', 'move', 'look'] as const) {
      const tabs = propLayout(state({ page })).widgets.filter((w) => w.id.startsWith('page-'))
      expect(tabs.filter((t) => t.active).map((t) => t.id)).toEqual([`page-${page}`])
    }
  })
})

describe('propLayout — geometry of the quad', () => {
  const everyState: XrPropState[] = [
    state({ page: 'select' }),
    state({ page: 'select', node: null, count: 0 }),
    state({ page: 'select', select: { criterion: 'topo', values: [], selectable: 0 } }),
    state({ page: 'shape' }),
    state({ page: 'move' }),
    state({ page: 'move', grabMode: 'size' }),
    state({ page: 'look' }),
    state({ node: null, count: 0 }),
    state({ page: 'shape', node: node({ type: NodeType.WorldGrid }) }),
    state({ page: 'draw' }),
    state({ page: 'draw', node: null, count: 0, draw: draw({ drawing: true, stamps: 12, nodes: 84 }) }),
    state({ page: 'draw', draw: draw({ gridId: null }) }),
    state({ page: 'draw', draw: draw({ gridIsGlobe: true }) }),
    state({ page: 'draw', draw: draw({ brushes: ['Single Object', 'Tree'], brushIndex: 1 }) }),
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

  it('gives every widget a hittable SIZE — a ray has about a degree of jitter', () => {
    // In centimetres, not in fractions of the quad. A normalised threshold was
    // only ever a proxy for this, and it silently changes meaning the moment
    // the panel's own dimensions do — which is exactly what happened when the
    // mode column arrived and the quad grew to carry it. 2.4 cm at a 40 cm
    // reading distance is about 3.4°, comfortably past a pointing hand's ~1°.
    for (const s of everyState) {
      for (const widget of propLayout(s).widgets) {
        expect(widget.rect.w * PANEL_W_M, `${widget.id} width`).toBeGreaterThanOrEqual(0.024)
        expect(widget.rect.h * PANEL_H_M, `${widget.id} height`).toBeGreaterThanOrEqual(0.022)
      }
    }
  })

  it('keeps the mode column clear of the content', () => {
    // The two halves are laid out independently — the column on the panel's own
    // coordinates, everything else through cx/cw — so nothing but this stops
    // them from being tuned into each other.
    for (const s of everyState) {
      for (const widget of propLayout(s).widgets) {
        if (isPageWidget(widget.id)) {
          expect(widget.rect.x + widget.rect.w, widget.id).toBeLessThanOrEqual(CONTENT_X)
        } else if (widget.id !== 'pin') {
          expect(widget.rect.x, widget.id).toBeGreaterThanOrEqual(CONTENT_X)
        }
      }
    }
  })

  it('has room in the column for modes that do not exist yet', () => {
    // The whole reason the tabs moved off the top edge: a row of four had run
    // out of width by construction, where a column is bounded by height and the
    // panel has spare rows. Draw Mode is the next one in.
    expect(PAGES.length).toBeLessThan(MAX_ROWS)
    const lowest = rowY(MAX_ROWS - 1) + 0.115
    expect(lowest).toBeLessThanOrEqual(0.97)
  })
})

describe('propLayout — the Select page', () => {
  it('offers the Select By steppers, the bulk commands and the visibility row', () => {
    expect(ids(state({ page: 'select' }))).toEqual([
      'pin',
      'page-select',
      'page-shape',
      'page-move',
      'page-look',
      'page-draw',
      'criterion-prev',
      'criterion-next',
      'value-prev',
      'value-next',
      'select-apply',
      'select-add',
      'select-all',
      'select-none',
      'select-invert',
      'vis-hide',
      'vis-show',
      'vis-only',
    ])
  })

  it('renders with NOTHING selected — which is what the page is for', () => {
    const layout = propLayout(state({ page: 'select', node: null, count: 0 }))
    expect(layout.empty).toBeNull()
    expect(layout.rows.length).toBeGreaterThan(0)
    expect(layout.title).toBe('Select')
    expect(layout.subtitle).toBe('109 nodes available')
  })

  it('says how many are selected once there are any', () => {
    expect(propLayout(state({ page: 'select', count: 7 })).title).toBe('Select · 7 selected')
  })

  it('shows the criterion and the value the steppers point at', () => {
    const layout = propLayout(state({ page: 'select', valueIndex: 2 }))
    const value = (caption: string) => layout.rows.find((r) => r.caption === caption)?.value
    expect(value('by')).toBe(CRITERION_LABELS.branchLevel)
    expect(value('value')).toBe('2')
  })

  it('names the criterion the model was handed, not a fixed one', () => {
    const layout = propLayout(
      state({
        page: 'select',
        select: { criterion: 'geometry', values: [{ value: 3, label: '3: Cube' }], selectable: 4 },
      }),
    )
    expect(layout.rows.find((r) => r.caption === 'by')?.value).toBe(CRITERION_LABELS.geometry)
    expect(layout.rows.find((r) => r.caption === 'value')?.value).toBe('3: Cube')
  })

  it('greys the value stepper and Select when the scene offers no values', () => {
    const widgets = propLayout(
      state({ page: 'select', select: { criterion: 'topo', values: [], selectable: 0 } }),
    ).widgets
    const off = (id: string) => widgets.find((w) => w.id === id)?.disabled === true
    expect(off('value-prev') && off('value-next') && off('select-apply')).toBe(true)
    // The bulk commands are still meaningful — Select All does not need a value.
    expect(off('select-all')).toBe(false)
  })

  it('renames the apply button by what the Add checkbox will make it do', () => {
    const label = (add: boolean) =>
      propLayout(state({ page: 'select', addToSelection: add })).widgets.find(
        (w) => w.id === 'select-apply',
      )?.label
    expect(label(false)).toBe('Select matching')
    expect(label(true)).toBe('Add matching')
  })

  it('reflects the Add checkbox', () => {
    const checked = (add: boolean) =>
      propLayout(state({ page: 'select', addToSelection: add })).widgets.find(
        (w) => w.id === 'select-add',
      )?.checked
    expect(checked(false)).toBe(false)
    expect(checked(true)).toBe(true)
  })

  it('greys Hide and Only with no selection, but never Show all', () => {
    // Show all is the way OUT of a hide, so it has to stay reachable from a
    // state where everything visible has been hidden and nothing is selected.
    const widgets = propLayout(state({ page: 'select', node: null, count: 0 })).widgets
    const off = (id: string) => widgets.find((w) => w.id === id)?.disabled === true
    expect(off('vis-hide')).toBe(true)
    expect(off('vis-only')).toBe(true)
    expect(off('vis-show')).toBe(false)
  })

  it('leaves the visibility row live once something is selected', () => {
    const widgets = propLayout(state({ page: 'select', count: 3 })).widgets
    for (const id of ['vis-hide', 'vis-show', 'vis-only']) {
      expect(widgets.find((w) => w.id === id)?.disabled).toBeFalsy()
    }
  })
})

describe('propLayout — the Shape page', () => {
  it('offers the enum steppers, ratio and texture', () => {
    expect(ids(state({ page: 'shape' }))).toEqual([
      'pin',
      'page-select',
      'page-shape',
      'page-move',
      'page-look',
      'page-draw',
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
      'page-select',
      'page-shape',
      'page-move',
      'page-look',
      'page-draw',
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
      'grab-move',
      'grab-turn',
      'grab-size',
    ])
  })

  it('marks the armed grab mode and no other', () => {
    for (const mode of ['move', 'turn', 'size'] as const) {
      const chips = propLayout(state({ page: 'move', grabMode: mode })).widgets.filter((w) =>
        w.id.startsWith('grab-'),
      )
      expect(chips).toHaveLength(3)
      expect(chips.filter((c) => c.active).map((c) => c.id)).toEqual([`grab-${mode}`])
    }
  })

  it('captions the grab row, since a chip row with no label names nothing', () => {
    // Twice over two sessions an unlabelled control shipped and was only caught
    // in the rendered texture; a headset has no tooltip to fall back on.
    const rows = propLayout(state({ page: 'move' })).rows
    expect(rows.some((r) => r.caption === 'grab')).toBe(true)
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
      'page-select',
      'page-shape',
      'page-move',
      'page-look',
      'page-draw',
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

describe('propLayout — the Draw page', () => {
  it('offers the mode toggle, the brush and the four settings', () => {
    expect(ids(state({ page: 'draw' }))).toEqual([
      'pin',
      'page-select',
      'page-shape',
      'page-move',
      'page-look',
      'page-draw',
      'draw-toggle',
      'brush-prev',
      'brush-next',
      'drawz-dec',
      'drawz-scrub',
      'drawz-inc',
      'spacing-dec',
      'spacing-scrub',
      'spacing-inc',
      'spin-dec',
      'spin-scrub',
      'spin-inc',
      'sizejit-dec',
      'sizejit-scrub',
      'sizejit-inc',
    ])
  })

  it('renders with NOTHING selected — drawing needs no selection', () => {
    const layout = propLayout(state({ page: 'draw', node: null, count: 0 }))
    expect(layout.empty).toBeNull()
    expect(layout.rows).toHaveLength(6)
  })

  it('fills all six rows, which is what the sixth slot was left for', () => {
    // If a later page wants a seventh, the lattice is what has to change — not
    // this page quietly overflowing off the bottom of the quad.
    const layout = propLayout(state({ page: 'draw' }))
    expect(layout.rows.map((r) => r.y)).toEqual([0, 1, 2, 3, 4, 5].map(rowY))
  })

  it('names the toggle by what pressing it does', () => {
    const off = propLayout(state({ page: 'draw' })).widgets.find((w) => w.id === 'draw-toggle')!
    expect(off.label).toBe('Start drawing')
    expect(off.active).toBe(false)
    const on = propLayout(
      state({ page: 'draw', draw: draw({ drawing: true }) }),
    ).widgets.find((w) => w.id === 'draw-toggle')!
    expect(on.label).toBe('Stop drawing')
    expect(on.active).toBe(true)
  })

  it('refuses to arm on a globe grid, which has no drawing plane', () => {
    const layout = propLayout(state({ page: 'draw', draw: draw({ gridIsGlobe: true }) }))
    expect(layout.widgets.find((w) => w.id === 'draw-toggle')?.disabled).toBe(true)
    expect(layout.subtitle).toContain('globe')
  })

  it('says a gridless scene will get a grid rather than failing silently', () => {
    expect(propLayout(state({ page: 'draw', draw: draw({ gridId: null }) })).subtitle).toContain(
      'starting will make one',
    )
  })

  it('greys the brush stepper until there is more than one brush', () => {
    const one = propLayout(state({ page: 'draw' })).widgets.find((w) => w.id === 'brush-next')!
    expect(one.disabled).toBe(true)
    const two = propLayout(
      state({ page: 'draw', draw: draw({ brushes: ['Single Object', 'Tree'] }) }),
    ).widgets.find((w) => w.id === 'brush-next')!
    expect(two.disabled).toBe(false)
  })

  it('shows the brush the host says is chosen', () => {
    const rows = propLayout(
      state({ page: 'draw', draw: draw({ brushes: ['Single Object', 'Tree'], brushIndex: 1 }) }),
    ).rows
    expect(rows[1]).toMatchObject({ caption: 'brush', value: 'Tree' })
  })

  it('reports what the strokes drew — the status line is DOM and unseen here', () => {
    expect(propLayout(state({ page: 'draw', draw: draw({ stamps: 12, nodes: 84 }) })).subtitle).toBe(
      'Grid 7 · drew 12 stamps · 84 nodes',
    )
    // One node per stamp is the single-object brush, and reads as objects.
    expect(propLayout(state({ page: 'draw', draw: draw({ stamps: 3, nodes: 3 }) })).subtitle).toBe(
      'Grid 7 · drew 3 objects',
    )
  })

  it('shows the four settings in their own units', () => {
    const rows = propLayout(
      state({
        page: 'draw',
        draw: draw({ drawZ: 2.5, spacing: 8, headingJitter: 45, scaleJitter: 20 }),
      }),
    ).rows
    expect(rows[2]).toMatchObject({ caption: 'draw Z', value: '2.5' })
    expect(rows[3]).toMatchObject({ caption: 'spacing', value: '8' })
    expect(rows[4]).toMatchObject({ caption: 'spin ±°', value: '45' })
    expect(rows[5]).toMatchObject({ caption: 'size ±%', value: '20' })
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
    // The caption column is inside the CONTENT region now — the panel's own
    // left edge belongs to the mode buttons.
    expect(widgetAt(widgets, cx(0.1), rowY(1) + 0.05)).toBeNull()
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
