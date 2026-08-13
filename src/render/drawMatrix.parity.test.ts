// Cross-implementation parity for the DRAW matrix — what actually reaches the
// screen, as opposed to placement.
//
// parity.test.ts diffs `compute_world_transforms`' world position and raw world
// basis. Those carry neither base_scale nor the 0.2 render floor: the desktop
// applies both once, in `node_world_matrix`'s
//
//     M3 = parent_basis @ child_local @ S_child
//     S_child = diag(own scale * base_scale, floored at 0.2)
//
// so a placement-only harness is blind to them. It was: the web app floored the
// ACCUMULATED world scale instead of each node's own, which stopped a deeply
// nested glyph from shrinking past 0.2 and left it far too big (reported by
// Jeff 2026-07-27 — a hyperglyph pasted onto a small child overwhelmed it).
//
// The first fixture is that report's shape: a chain of 0.3-scaled nodes four
// deep (cumulative 0.0081, far under the floor, while no single node reaches
// it), plus a node whose OWN scale is under the floor, non-uniform scales, and
// rotations at several levels so the composition cannot commute its way to a
// right answer. Rod rows joined it on 2026-07-28 for the second divergence this
// layer exposed (see the rod test below), including a rod under scaled and
// rotated ancestors, a rod whose own scale is under the floor, a child hanging
// off a rod, and a World Grid carrying topo 6 — which is never rod-shaped.
//
// The second is the real Topology_Example, diffed glyph for glyph.
//
// Regenerate either JSON with tools/dump_draw_matrices.py when the fixture or
// the desktop draw math changes.

import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import {
  DEFAULT_BASE_SCALE,
  DEFAULT_SCALE_FLOOR,
  enforceScaleFloor,
  NO_SCALE_FLOOR,
  scaleFloor,
  setBaseScale,
  setEnforceScaleFloor,
} from './baseScale'
import { buildScene, rescaleSceneFrames } from './buildScene'
import drawScaleCsv from '../gv/fixtures/draw_scale_example_gv_node.csv?raw'
import drawScaleReferenceRaw from '../gv/fixtures/draw_scale_example_draw_matrices.json?raw'
import drawScaleScaled25Raw from '../gv/fixtures/draw_scale_example_draw_matrices_scale25.json?raw'
import drawScaleNoFloorRaw from '../gv/fixtures/draw_scale_example_draw_matrices_nofloor.json?raw'
import topologyCsv from '../gv/fixtures/topology_example_gv_node.csv?raw'
import topologyReferenceRaw from '../gv/fixtures/topology_example_draw_matrices.json?raw'
import topologyScaled25Raw from '../gv/fixtures/topology_example_draw_matrices_scale25.json?raw'
import topologyNoFloorRaw from '../gv/fixtures/topology_example_draw_matrices_nofloor.json?raw'

interface DrawReference {
  source_csv: string
  base_scale: number
  /** Desktop `Scene.scale_floor` the dump was taken at: 0.2 on, 0 off. */
  scale_floor: number
  nodes: { id: number; matrix: number[][]; radius: number }[]
}

// Every fixture below except the two `_nofloor` ones was dumped with the
// minimum-rendered-size clamp ON (`Scene.scale_floor = 0.2`), which is how both
// apps rendered unconditionally until 2026-08-13. It is opt-in and OFF by
// default on both sides now, so the suites that diff those dumps have to switch
// it on — and the `_nofloor` suite at the end is the other half of the check.
beforeEach(() => setEnforceScaleFloor(true))
afterEach(() => setEnforceScaleFloor(false))

/** Desktop row-major M[row][col] → the Three.js column-major element index. */
function webElement(m: THREE.Matrix4, row: number, col: number): number {
  return m.elements[col * 4 + row]
}

/**
 * Diff every glyph in a build against a dump, returning how many were compared —
 * the loop the two default-scale suites below spell out, reused by the Global
 * Scale ones so a difference between them can only be the scale.
 */
function expectMatchesDump(
  built: ReturnType<typeof buildScene>,
  reference: DrawReference,
  label: string,
): number {
  built.root.updateMatrixWorld(true)
  let compared = 0
  for (const entry of reference.nodes) {
    // World/Camera rows, links and hidden nodes carry a frame but no glyph; the
    // desktop's node_draw_data answers for every row regardless.
    const glyph = built.frames.get(entry.id)?.getObjectByName('glyph')
    if (!glyph) continue
    compared++
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        expect(
          webElement(glyph.matrixWorld, row, col),
          `${label}: node ${entry.id} M[${row}][${col}]`,
        ).toBeCloseTo(entry.matrix[row][col], 9)
      }
    }
  }
  return compared
}

describe('draw-matrix parity with the desktop engine', () => {
  const reference: DrawReference = JSON.parse(drawScaleReferenceRaw)
  const parsed = parseGvNodeCsv(drawScaleCsv)

  it('parses the fixture cleanly', () => {
    expect(parsed.errors).toEqual([])
    expect(reference.base_scale).toBe(1)
    expect(reference.scale_floor).toBe(0.2)
    expect(reference.nodes.length).toBe(parsed.nodes.length)
  })

  it('matches every glyph draw matrix', () => {
    const built = buildScene(parsed.nodes, {})
    built.root.updateMatrixWorld(true)

    for (const entry of reference.nodes) {
      const frame = built.frames.get(entry.id)
      expect(frame, `node ${entry.id} has no frame`).toBeDefined()
      const glyph = frame!.getObjectByName('glyph')
      expect(glyph, `node ${entry.id} has no glyph`).toBeDefined()

      // The glyph carries the floored own scale; the frame chain above it
      // carries every ancestor's raw rotation·scale, so its world matrix is the
      // desktop's M in full.
      const m = glyph!.matrixWorld
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          expect(
            webElement(m, row, col),
            `node ${entry.id} M[${row}][${col}]`,
          ).toBeCloseTo(entry.matrix[row][col], 9)
        }
      }
    }
  })

  it('keeps shrinking a deep chain instead of flooring the accumulated scale', () => {
    // The regression itself, stated in the terms the bug report was made in.
    // Node 5 sits under four 0.3-scaled ancestors: 0.3^4 = 0.0081, which the
    // old cumulative floor rounded up to 0.2 — 24x too large on screen.
    const built = buildScene(parsed.nodes, {})
    built.root.updateMatrixWorld(true)
    const deep = built.frames.get(5)!.getObjectByName('glyph')!
    const scale = new THREE.Vector3().setFromMatrixScale(deep.matrixWorld)
    expect(scale.x).toBeCloseTo(0.3 ** 4, 9)

    // …while a node whose OWN scale is under the floor still gets it: 0.05 → 0.2.
    const floored = built.frames.get(6)!.getObjectByName('glyph')!
    const flooredScale = new THREE.Vector3().setFromMatrixScale(floored.matrixWorld)
    expect(flooredScale.y).toBeCloseTo(0.2, 9)
  })

  it('draws a Rod-topo node narrow, long, and standing on its bottom cap', () => {
    // The second divergence this harness exposed, noted when it was built and
    // fixed 2026-07-28. A node whose own topo is Rod is drawn by the desktop
    // with _ROD_SCALE_FACTORS (0.25, 0.25, 5.0) and a cap offset
    // pos += M3[:, 2], putting the cylinder's bottom at its world origin (ANTz
    // kNPoffsetRod). The web did neither, so every rod drew at the wrong
    // proportions and ~5 units low — visible in two built-in scenes (the
    // topology example, node 37, and the sine wave).
    const built = buildScene(parsed.nodes, {})
    built.root.updateMatrixWorld(true)

    // Node 13: unrotated root rod at (0, −20, 0), scale 1 throughout.
    const rod = built.frames.get(13)!.getObjectByName('glyph')!
    const scale = new THREE.Vector3().setFromMatrixScale(rod.matrixWorld)
    expect([scale.x, scale.y, scale.z]).toEqual([
      expect.closeTo(0.25, 9),
      expect.closeTo(0.25, 9),
      expect.closeTo(5, 9),
    ])
    const pos = new THREE.Vector3().setFromMatrixPosition(rod.matrixWorld)
    // Half the drawn length up the rendered Z axis: the origin is the cap.
    expect([pos.x, pos.y, pos.z]).toEqual([
      expect.closeTo(0, 9),
      expect.closeTo(-20, 9),
      expect.closeTo(5, 9),
    ])

    // Neither factor nor offset reaches a CHILD, because both live on the
    // glyph: the desktop's parent_basis carries only raw rotation·scale, so
    // the FRAME children hang from stays at the row's own world position…
    expect(built.frames.get(13)!.position.z).toBeCloseTo(0, 9)
    // …and node 14 keeps its own 0.6, not 0.6 × 0.25. (Where the rod topology
    // then puts it along the axis is placement, diffed above matrix by matrix.)
    const childScale = new THREE.Vector3().setFromMatrixScale(
      built.frames.get(14)!.getObjectByName('glyph')!.matrixWorld,
    )
    expect(childScale.x).toBeCloseTo(0.6, 9)

    // The two ports agree, which is the check a screenshot would make: the
    // glyph is 2 units long before scaling, so it now draws over z ∈ [0, 10] —
    // exactly the span topology.ts maps a rod child's tx ∈ [0, 180] onto
    // (2 · ROD_HEIGHT_FACTOR · B). Node 14's tx of 90 puts it at the rod's
    // midpoint, z = 5. Before the cap offset the glyph ran [−5, 5] and half of
    // its children hung off the end of it.
    expect(built.frames.get(14)!.position.z).toBeCloseTo(5, 9)

    // A World Grid is never rod-shaped even with topo 6 (the desktop's
    // `rod & ~grids`): node 19 keeps its extents footprint.
    const grid = built.frames.get(19)!.getObjectByName('glyph')!
    const gridScale = new THREE.Vector3().setFromMatrixScale(grid.matrixWorld)
    expect([gridScale.x, gridScale.y]).toEqual([expect.closeTo(180, 9), expect.closeTo(90, 9)])
  })
})

// The synthetic fixture above is built to expose one class of mistake at a
// time. This one is the real Topology_Example — the scene both apps open by
// default — diffed glyph for glyph. Its rod (node 37) is exactly why it is
// here: the rod factors went unported for four months precisely because no
// draw-matrix fixture contained one, and the placement harness that DOES cover
// this scene (parity.test.ts, all 109 nodes) is blind to base_scale, the 0.2
// floor and the rod factors alike, since none of them exist at its layer. A
// real scene is the cheapest guard against the next thing nobody thought to
// put in a hand-written fixture.
describe('draw-matrix parity on the real Topology_Example', () => {
  const reference: DrawReference = JSON.parse(topologyReferenceRaw)
  const parsed = parseGvNodeCsv(topologyCsv)

  it('matches every drawn glyph, rod included', () => {
    expect(parsed.errors).toEqual([])
    const built = buildScene(parsed.nodes, {})
    built.root.updateMatrixWorld(true)

    let compared = 0
    for (const entry of reference.nodes) {
      // World/Camera rows, links and hidden nodes carry a frame but no glyph;
      // the desktop's node_draw_data answers for every row regardless.
      const glyph = built.frames.get(entry.id)?.getObjectByName('glyph')
      if (!glyph) continue
      compared++
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          expect(
            webElement(glyph.matrixWorld, row, col),
            `node ${entry.id} M[${row}][${col}]`,
          ).toBeCloseTo(entry.matrix[row][col], 9)
        }
      }
    }
    // Guards the loop itself: a build that stopped producing glyphs would
    // otherwise pass by comparing nothing.
    expect(compared).toBeGreaterThan(100)
  })
})

// Global Scale (`Viewport.base_scale`), shipped 2026-07-30. Until then this
// harness only ever ran at the default 1.0 — it asserted so — which made it
// blind to the one input to a draw matrix that no CSV can carry, and blind in
// both directions: base_scale multiplies the own scale BEFORE the 0.2 floor (so
// it lifts small nodes off it, rather than scaling what the floor produced), and
// `compute_world_transforms` separately takes it as every topology's base
// radius, so children placed on a parent's surface ride outward with it.
//
// 2.5 is chosen to be a scale where all of that is visible at once: the deep
// 0.3-chain node lands at 0.75 (still shrinking, nowhere near the floor), the
// 0.05 node reaches 0.125 and is still floored to 0.2, and the rod's own
// factors compose on top of a scaled base.
describe('draw-matrix parity at a non-default Global Scale', () => {
  const GLOBAL_SCALE = 2.5

  beforeEach(() => {
    setBaseScale(GLOBAL_SCALE)
  })
  afterEach(() => {
    // Module-level state: every other suite in this run reads the default.
    setBaseScale(DEFAULT_BASE_SCALE)
  })

  it('matches the desktop on the draw-scale fixture', () => {
    const reference: DrawReference = JSON.parse(drawScaleScaled25Raw)
    expect(reference.base_scale).toBe(GLOBAL_SCALE)
    const parsed = parseGvNodeCsv(drawScaleCsv)
    const built = buildScene(parsed.nodes, {})
    expect(expectMatchesDump(built, reference, 'draw-scale @2.5')).toBeGreaterThan(10)
  })

  it('matches the desktop on the real Topology_Example', () => {
    const reference: DrawReference = JSON.parse(topologyScaled25Raw)
    const parsed = parseGvNodeCsv(topologyCsv)
    const built = buildScene(parsed.nodes, {})
    // Every topology family at once, which is what makes this the placement half
    // of the check: a base radius applied to the wrong term would move children
    // off their parents' surfaces here while the synthetic fixture (Cartesian
    // throughout, bar its rods) stayed green.
    expect(expectMatchesDump(built, reference, 'topology @2.5')).toBeGreaterThan(100)
  })

  it('floors after the multiply, not before', () => {
    // The order the desktop uses: max(own · base, 0.2). A node at 0.05 is
    // floored to 0.2 at scale 1 and still floored at 2.5 (0.125), so a
    // "floor first, then scale" implementation would draw it at 0.5.
    const parsed = parseGvNodeCsv(drawScaleCsv)
    const built = buildScene(parsed.nodes, {})
    built.root.updateMatrixWorld(true)
    const floored = new THREE.Vector3().setFromMatrixScale(
      built.frames.get(6)!.getObjectByName('glyph')!.matrixWorld,
    )
    expect(floored.y).toBeCloseTo(0.2, 9)
    // …while the deep chain, which the floor never touches, scales cleanly.
    const deep = new THREE.Vector3().setFromMatrixScale(
      built.frames.get(5)!.getObjectByName('glyph')!.matrixWorld,
    )
    expect(deep.x).toBeCloseTo(0.3 ** 4 * GLOBAL_SCALE, 9)
  })
})

// The Global Scale slider does NOT rebuild the scene — it rewrites the existing
// Object3Ds in place (rescaleSceneFrames), because re-creating every glyph,
// material binding and pick proxy per slider step is unaffordable at 209k nodes.
// That makes "in place equals rebuilt" the one thing the feature rests on, and
// this is the check for it: the same scene taken to 2.5 both ways, diffed
// against each other AND against the desktop's own dump for that scale.
describe('in-place rescale equals a fresh build', () => {
  afterEach(() => {
    setBaseScale(DEFAULT_BASE_SCALE)
  })

  it('reproduces the desktop matrices after a slider drag', () => {
    const reference: DrawReference = JSON.parse(topologyScaled25Raw)

    // Built at the default, like a scene loaded before the slider is touched…
    setBaseScale(DEFAULT_BASE_SCALE)
    const built = buildScene(parseGvNodeCsv(topologyCsv).nodes, {})
    built.root.updateMatrixWorld(true)

    // …then dragged, twice, since a slider passes through values on the way and
    // each apply must start from the node rows rather than from the last result.
    for (const value of [7.3, 2.5]) {
      setBaseScale(value)
      rescaleSceneFrames(parseGvNodeCsv(topologyCsv).nodes, built.frames)
    }

    expect(expectMatchesDump(built, reference, 'rescaled @2.5')).toBeGreaterThan(100)
  })

  it('leaves a World Grid footprint alone while still placing it', () => {
    // gridDrawScale is base_scale-exempt on both sides (scene._grid_draw_scale),
    // so a grid's plate must not move under the slider — but its own frame still
    // takes a topology offset from whatever it hangs under.
    const parsed = parseGvNodeCsv(drawScaleCsv)
    setBaseScale(DEFAULT_BASE_SCALE)
    const built = buildScene(parsed.nodes, {})
    built.root.updateMatrixWorld(true)
    const gridGlyph = built.frames.get(19)!.getObjectByName('glyph')!
    const before = gridGlyph.scale.clone()

    setBaseScale(4)
    rescaleSceneFrames(parsed.nodes, built.frames)
    expect(gridGlyph.scale.x).toBeCloseTo(before.x, 12)
    expect(gridGlyph.scale.y).toBeCloseTo(before.y, 12)
    expect(gridGlyph.scale.z).toBeCloseTo(before.z, 12)
  })
})

// The minimum rendered size (desktop `Scene.scale_floor`), which BOTH apps now
// leave off by default — shipped there in 6d82d68 because the clamp silently
// overrode authored data (its AutoSleep example's deliberately thin 0.07 h axis
// was inflated to 0.2, so the encoding lied about the data), and ported here
// 2026-08-13.
//
// This is the direction the harness could not previously see at all: it
// asserted the clamp as a renderer fact, so a build that ignored the setting
// would have gone on passing. These two dumps are the same fixtures at the same
// Global Scale with `scale_floor = 0`, so any difference between them and the
// suites above is the clamp and nothing else.
describe('draw-matrix parity with the minimum glyph size OFF', () => {
  beforeEach(() => setEnforceScaleFloor(false))

  it('matches the desktop on the draw-scale fixture', () => {
    const reference: DrawReference = JSON.parse(drawScaleNoFloorRaw)
    expect(reference.scale_floor).toBe(0)
    expect(reference.base_scale).toBe(1)
    const built = buildScene(parseGvNodeCsv(drawScaleCsv).nodes, {})
    expect(expectMatchesDump(built, reference, 'draw-scale, floor off')).toBeGreaterThan(10)
  })

  it('matches the desktop on the real Topology_Example', () => {
    const reference: DrawReference = JSON.parse(topologyNoFloorRaw)
    expect(reference.scale_floor).toBe(0)
    const built = buildScene(parseGvNodeCsv(topologyCsv).nodes, {})
    expect(expectMatchesDump(built, reference, 'topology, floor off')).toBeGreaterThan(100)
  })

  it('draws a tiny glyph at exactly its authored scale', () => {
    // Node 6's own scale is 0.05 — clamped to 0.2 (4× too big) with the option
    // on, which is the case that made the desktop turn it off by default.
    const built = buildScene(parseGvNodeCsv(drawScaleCsv).nodes, {})
    built.root.updateMatrixWorld(true)
    const glyph = built.frames.get(6)!.getObjectByName('glyph')!
    const scale = new THREE.Vector3().setFromMatrixScale(glyph.matrixWorld)
    expect(scale.y).toBeCloseTo(0.05, 9)
  })

  it('keeps a sliver its own shape instead of squaring it up', () => {
    // The desktop's own test case: a 4 × 0.05 × 0.05 node is a needle, and the
    // clamp turns two of its axes into 0.2 — a 20:1 shape becomes 20:4.
    const parsed = parseGvNodeCsv(drawScaleCsv)
    const sliver = parsed.nodes.find((n) => n.id === 6)!
    sliver.scale = { x: 4, y: 0.05, z: 0.05 }
    const built = buildScene(parsed.nodes, {})
    built.root.updateMatrixWorld(true)
    const scale = new THREE.Vector3().setFromMatrixScale(
      built.frames.get(6)!.getObjectByName('glyph')!.matrixWorld,
    )
    expect(scale.x / scale.y).toBeCloseTo(80, 6)

    // …and with the clamp on, the same node is 4 × 0.2 × 0.2.
    setEnforceScaleFloor(true)
    const clamped = buildScene(parsed.nodes, {})
    clamped.root.updateMatrixWorld(true)
    const clampedScale = new THREE.Vector3().setFromMatrixScale(
      clamped.frames.get(6)!.getObjectByName('glyph')!.matrixWorld,
    )
    expect(clampedScale.x / clampedScale.y).toBeCloseTo(20, 6)
  })

  it('is the DEFAULT — a fresh module state renders authored scale', () => {
    // The setting is module-level state; this pins which way it boots, since
    // every other suite in this file explicitly turns it on.
    setEnforceScaleFloor(false)
    expect(enforceScaleFloor()).toBe(false)
    expect(scaleFloor()).toBe(NO_SCALE_FLOOR)
    expect(DEFAULT_SCALE_FLOOR).toBe(0.2)
  })
})
