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
// The fixture is that report's shape: a chain of 0.3-scaled nodes four deep
// (cumulative 0.0081, far under the floor, while no single node reaches it),
// plus a node whose OWN scale is under the floor, non-uniform scales, and
// rotations at several levels so the composition cannot commute its way to a
// right answer.
//
// Regenerate the JSON with tools/dump_draw_matrices.py when the fixture or the
// desktop draw math changes.

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { parseGvNodeCsv } from '../gv/nodeCsv'
import { buildScene } from './buildScene'
import drawScaleCsv from '../gv/fixtures/draw_scale_example_gv_node.csv?raw'
import drawScaleReferenceRaw from '../gv/fixtures/draw_scale_example_draw_matrices.json?raw'

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
})
