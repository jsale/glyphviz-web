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
import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { buildScene } from './buildScene'
import drawScaleCsv from '../gv/fixtures/draw_scale_example_gv_node.csv?raw'
import drawScaleReferenceRaw from '../gv/fixtures/draw_scale_example_draw_matrices.json?raw'
import topologyCsv from '../gv/fixtures/topology_example_gv_node.csv?raw'
import topologyReferenceRaw from '../gv/fixtures/topology_example_draw_matrices.json?raw'

interface DrawReference {
  source_csv: string
  base_scale: number
  nodes: { id: number; matrix: number[][]; radius: number }[]
}

/** Desktop row-major M[row][col] → the Three.js column-major element index. */
function webElement(m: THREE.Matrix4, row: number, col: number): number {
  return m.elements[col * 4 + row]
}

describe('draw-matrix parity with the desktop engine', () => {
  const reference: DrawReference = JSON.parse(drawScaleReferenceRaw)
  const parsed = parseGvNodeCsv(drawScaleCsv)

  it('parses the fixture cleanly', () => {
    expect(parsed.errors).toEqual([])
    expect(reference.base_scale).toBe(1)
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
