// The Epitrochoid Generator's engine, for the claims that do not need the
// desktop to state (those are in epicycles.parity.test.ts, and the geometric
// ones — the ladder, the tilt, the tube, closure — are in
// src/render/epicyclePath.test.ts, where a real placement pass is available).
//
// What is pinned here is the structure the CSV depends on: the trail's Plot
// parent, the shared bead↔frame mapping, contiguous ids, the design JSON round
// trip, and the two formatters the labels and the filenames go through.

import { describe, expect, it } from 'vitest'
import {
  buildChannels,
  buildEpicycleNodes,
  closureFrames,
  continuedArm,
  defaultArm,
  defaultDesign,
  designFromJson,
  designToJson,
  formatG,
  MAX_TRAIL_POINTS,
  MAX_TUBE_FRACTION,
  chainNodes,
  frameCount,
  preset,
  PRESET_NAMES,
  slug,
  trailSampling,
  writeChMapCsv,
  writeChTracksCsv,
} from './epicycles'
import type { Vec3 } from './types'
import { Geometry, NodeType, Topo } from './types'

/** A stand-in path — the structural tests do not care where the pen went. */
function fakePath(frames: number): Vec3[] {
  return Array.from({ length: frames }, (_, f) => ({ x: f, y: -f, z: f / 2 }))
}

function build(design = preset("Jeff's ANTz original"), startId = 1, includeWorld = false) {
  const frames = frameCount(design)
  return buildEpicycleNodes(design, { startId, includeWorld, path: fakePath(frames) })
}

describe('the trail', () => {
  it('has a TRANSPARENT Plot parent, not a hidden one', () => {
    // A hidden Plot parent suppresses the polyline entirely, so the trail would
    // be beads with no line through them. Easy to "tidy up" into hide = 1 later.
    const plot = build().find((n) => n.topo === Topo.Plot)!
    expect(plot.hide).toBe(0)
    expect(plot.color.a).toBe(0)
    // The polyline's WIDTH comes from the parent's ratio × 20 px.
    expect(plot.ratio).toBeCloseTo(0.15, 12)
  })

  it('emits one Point bead per sampled frame, in row order', () => {
    // Plot draws through its children in CSV row order, so the row order IS the
    // curve's direction.
    const design = preset("Jeff's ANTz original")
    const frames = frameCount(design)
    const [step, count] = trailSampling(design, frames)
    const nodes = build(design)
    const plot = nodes.find((n) => n.topo === Topo.Plot)!
    const beads = nodes.filter((n) => n.parentId === plot.id)
    expect(beads).toHaveLength(count)
    beads.forEach((bead, i) => {
      expect(bead.geometry).toBe(Geometry.Point)
      expect(bead.translate.x).toBeCloseTo(i * step, 12)
    })
  })

  it('caps the requested points at the frame count and at MAX_TRAIL_POINTS', () => {
    // One bead per frame is as fine as the path is sampled, so a request past
    // the frame count is met exactly.
    expect(trailSampling(defaultDesign({ trailPoints: 10_000, frames: 200 }), 200)[1]).toBe(200)
    // The cap bounds the REQUEST; the step is then an integer, so the bead
    // count lands near the cap rather than on it (1440 asked, step 3, 1667
    // drawn — the desktop's own numbers, and where the hard MAX_TRAIL_POINTS
    // ceiling is a guard against a 50k-node scene, not a promise of a count).
    expect(trailSampling(defaultDesign({ trailPoints: 10_000 }), 5000)).toEqual([3, 1667])
    expect(MAX_TRAIL_POINTS).toBe(1440)
  })

  it('turning the trail off leaves the chain alone', () => {
    const design = preset('Cardioid (2 terms)')
    design.trail = false
    const nodes = build(design)
    expect(nodes.some((n) => n.topo === Topo.Plot)).toBe(false)
    expect(nodes.filter((n) => n.type === NodeType.Glyph)).toHaveLength(3) // hub + 2 arms
  })
})

describe('self-drawing channels', () => {
  it('shares one bead→frame mapping with the node builder', () => {
    // The two sides must agree about which frame a bead belongs to or the alpha
    // steps light at the wrong moment. 137 points is deliberately not a divisor
    // of the 360-frame period.
    const design = preset("Jeff's ANTz original")
    design.selfDrawing = true
    design.trailPoints = 137
    const frames = frameCount(design)
    const [, beads] = trailSampling(design, frames)

    const nodes = build(design)
    const plot = nodes.find((n) => n.topo === Topo.Plot)!
    const beadRows = nodes.filter((n) => n.parentId === plot.id)
    expect(beadRows).toHaveLength(beads)

    const channels = buildChannels(design, frames)
    const alpha = channels.map.filter((r) => r.attribute === 'color_a')
    expect(alpha).toHaveLength(Math.ceil(beads / design.beadGroup))
    const referenced = new Set(beadRows.map((b) => Number(b.extras.ch_input_id)))
    const declared = new Set(alpha.map((r) => r.channelId))
    for (const id of referenced) expect(declared.has(id)).toBe(true)
  })

  it('never runs the line ahead of the pen', () => {
    // A line drawing a curve the pen has not travelled yet would be a lie. A
    // group lights when its LAST bead is reached, so it lags instead.
    const design = preset("Jeff's ANTz original")
    design.selfDrawing = true
    const frames = frameCount(design)
    const [step] = trailSampling(design, frames)
    const channels = buildChannels(design, frames)
    const alpha = channels.map.filter((r) => r.attribute === 'color_a')
    alpha.forEach((row, g) => {
      const column = channels.tracks.get(row.trackId)!
      const on = column.findIndex((v) => v > 0)
      expect(on).toBeGreaterThanOrEqual(g * design.beadGroup * step)
    })
  })

  it('drives the arms from Channels instead of translate_rate', () => {
    // Two things writing the same angle would fight, so the rates are zeroed
    // and every moving node points at its own channel. The hub never moves and
    // gets none.
    const design = preset("Jeff's ANTz original")
    design.selfDrawing = true
    const nodes = build(design)
    const chain = nodes.filter((n) => n.type === NodeType.Glyph && n.topo === Topo.Torus)
    expect(chain.every((n) => n.translateRate.x === 0 && n.translateRate.y === 0)).toBe(true)
    expect(Number(chain[0].extras.ch_input_id)).toBe(0)
    chain.slice(1).forEach((n, k) => expect(Number(n.extras.ch_input_id)).toBe(k + 1))
  })

  it('writes a ch-map / ch-tracks pair that lines up', () => {
    const design = preset('Cardioid (2 terms)')
    design.selfDrawing = true
    design.trailPoints = 40
    const frames = frameCount(design)
    const channels = buildChannels(design, frames)
    const map = writeChMapCsv(channels).trim().split('\r\n')
    expect(map[0]).toBe('channel_id,track_id,attribute')
    expect(map).toHaveLength(1 + channels.map.length)

    const tracks = writeChTracksCsv(channels, frames).trim().split('\r\n')
    expect(tracks[0]).toBe(
      ['cyclecount', ...[...channels.tracks.keys()].sort((a, b) => a - b).map((i) => `ch${i}`)]
        .join(','),
    )
    expect(tracks).toHaveLength(1 + frames)
    expect(tracks[1].split(',')[0]).toBe('0')
  })

  it('leaves the beads visible and the rates live when it is OFF', () => {
    const design = preset('Cardioid (2 terms)')
    const nodes = build(design)
    const chain = nodes.filter((n) => n.type === NodeType.Glyph && n.topo === Topo.Torus)
    expect(chain.slice(1).some((n) => n.translateRate.x !== 0)).toBe(true)
    const plot = nodes.find((n) => n.topo === Topo.Plot)!
    expect(nodes.filter((n) => n.parentId === plot.id).every((b) => b.color.a > 0)).toBe(true)
  })
})

describe('ids and hierarchy', () => {
  it('are contiguous from startId, with no dangling references', () => {
    // Insert into Scene allocates from max(existing) + 1, so a gap or a repeat
    // would collide with the live scene.
    const nodes = build(preset('Inclined orrery (tilt)'), 500)
    expect(nodes.map((n) => n.id)).toEqual(nodes.map((_, i) => 500 + i))
    const known = new Set<number>([0, ...nodes.map((n) => n.id)])
    for (const n of nodes) {
      expect(known.has(n.parentId)).toBe(true)
      expect(known.has(Number(n.extras.child_id ?? 0))).toBe(true)
    }
  })

  it('lands the chain and the trail as two independent roots', () => {
    // The trail's beads are Cartesian world positions and only mean anything at
    // the top level, which is why Insert never nests this under a selection.
    const nodes = build()
    expect(nodes.filter((n) => n.parentId === 0)).toHaveLength(2)
  })

  it('links each ring centre to the next', () => {
    const design = preset('Deep chain (6 arms)')
    const links = build(design).filter((n) => n.type === NodeType.Link)
    expect(links).toHaveLength(design.arms.length)
    for (const link of links) {
      expect(link.geometry).toBe(Geometry.CylinderSolid)
      expect(Number(link.extras.child_id)).toBe(link.parentId + 1)
    }
    design.showArms = false
    expect(build(design).some((n) => n.type === NodeType.Link)).toBe(false)
  })

  it('adds the World row only for a standalone scene file', () => {
    // Right for a file, wrong for Insert into Scene — the open scene has one.
    expect(build(preset('Cardioid (2 terms)'), 1, true)[0].type).toBe(NodeType.World)
    expect(build(preset('Cardioid (2 terms)'), 1, false)[0].type).toBe(NodeType.Glyph)
  })
})

describe('the tube', () => {
  it('cannot swallow its own orbit', () => {
    // Ratio 1 degenerates the torus to a sphere and the arm's inner reach
    // passes through the hub, so the fraction is capped.
    const design = defaultDesign({
      arms: [defaultArm({ length: 10 }), defaultArm({ length: 4, tube: 99 })],
    })
    const chain = chainNodes(design, { startId: 1, parentId: 0, baseBranch: 0, animated: true })
    expect(chain[1].ratio).toBeCloseTo(MAX_TUBE_FRACTION, 12)
  })

  it('draws a real tube as WIREFRAME', () => {
    // A hairline orbit ring reads fine solid; a solid fat tube is an opaque
    // doughnut that hides the very mechanism it exists to show.
    const hairline = chainNodes(defaultDesign(), {
      startId: 1, parentId: 0, baseBranch: 0, animated: true,
    })
    expect(hairline[0].geometry).toBe(Geometry.TorusSolid)

    const fat = defaultDesign({
      arms: [defaultArm({ length: 10, tube: 5 }), defaultArm({ length: 5 })],
    })
    expect(
      chainNodes(fat, { startId: 1, parentId: 0, baseBranch: 0, animated: true })[0].geometry,
    ).toBe(Geometry.TorusWire)
  })
})

describe('design housekeeping', () => {
  it('round-trips every preset through JSON', () => {
    for (const name of PRESET_NAMES) {
      const design = preset(name)
      expect(designToJson(designFromJson(designToJson(design)))).toEqual(designToJson(design))
    }
  })

  it('refuses a file that is not a design, rather than emptying the one in hand', () => {
    expect(() => designFromJson(null)).toThrow()
    expect(() => designFromJson('nope')).toThrow()
    // A recipe .json from the Glyph Composer has no `arms`, so it loads as the
    // single-arm default rather than as a chain with no pen.
    expect(designFromJson({ name: 'x' }).arms).toHaveLength(1)
  })

  it('hands out copies, never the shared preset', () => {
    const a = preset('Cardioid (2 terms)')
    a.arms[0].length = 999
    expect(preset('Cardioid (2 terms)').arms[0].length).toBe(10)
  })

  it('every preset closes, so every preset is a figure', () => {
    for (const name of PRESET_NAMES) expect(closureFrames(preset(name))).toBeTruthy()
  })

  it('a new arm continues the pattern rather than swamping it', () => {
    const next = continuedArm(defaultArm({ length: 10, rateX: 3 }))
    expect(next.length).toBeCloseTo(6, 12)
    expect(next.rateX).toBe(-3)
    // A still arm has no direction to reverse, so the new one starts turning.
    expect(continuedArm(defaultArm({ rateX: 0 })).rateX).toBe(1)
  })
})

describe('formatters', () => {
  it('formatG is Python %g', () => {
    expect(formatG(10)).toBe('10')
    expect(formatG(1.5)).toBe('1.5')
    expect(formatG(1 / 3)).toBe('0.333333')
    expect(formatG(0)).toBe('0')
    expect(formatG(-2)).toBe('-2')
    expect(formatG(1e-5)).toBe('1e-05')
    expect(formatG(1234567)).toBe('1.23457e+06')
    expect(formatG(1, true)).toBe('+1')
    expect(formatG(-1, true)).toBe('-1')
    expect(formatG(0, true)).toBe('+0')
  })

  it('slug is a filename stem', () => {
    expect(slug('Fourier_V1')).toBe('fourier_v1')
    expect(slug('  My Design  ')).toBe('my_design')
    expect(slug('!!!')).toBe('epicycles')
  })
})
