// Cross-implementation parity for Draw Mode: the screen→grid inversion and the
// per-stamp jitter, diffed against the REAL desktop functions.
//
// The fixture is produced by tools/dump_draw_stamps.py, which calls
// glyphviz_core.draw_mode's own grid_hit / place_stamp / should_stamp — no
// restatement of the logic under test. See that script's docstring for why
// each case is in there.
//
// The jitter cases run the desktop's `random.Random(seed)`, so this is also a
// second user of src/gv/pythonRandom.ts's Mersenne Twister: a stamp's heading
// is `uniform(-j, +j)` on both sides, and the ORDER and COUNT of the draws is
// part of the behaviour (a jitter left at 0 must not advance the stream).

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { placeStamp, shouldStamp } from '../gv/drawMode'
import { blankNode, NEW_OBJECT_DEFAULTS } from '../gv/createNode'
import { PythonRandom } from '../gv/pythonRandom'
import type { GvNode } from '../gv/types'
import { gridHitInBasis } from './drawPlane'
import fixtureRaw from '../gv/fixtures/draw_stamps.json?raw'

interface HitCase {
  name: string
  ray_origin: [number, number, number]
  ray_direction: [number, number, number]
  grid_pos: [number, number, number]
  grid_basis: [number, number, number][]
  grid_center: [number, number]
  draw_z: number
  hit: [number, number] | null
}

interface StampRow {
  id: number
  parent_id: number
  branch_level: number
  translate_x: number
  translate_y: number
  translate_z: number
  rotate_x: number
  rotate_y: number
  rotate_z: number
  scale_x: number
  scale_y: number
  scale_z: number
}

interface StampCase {
  name: string
  base_branch_level: number
  lon: number
  lat: number
  z: number
  heading_jitter: number
  scale_jitter: number
  seed: number
  nodes_in: StampRow[]
  heading: number
  factor: number
  next_draw: number
  nodes_out: StampRow[]
}

interface SpacingCase {
  last: [number, number] | null
  x: number
  y: number
  spacing: number
  stamp: boolean
}

const fixture = JSON.parse(fixtureRaw) as {
  grid_hits: HitCase[]
  stamps: StampCase[]
  spacing: SpacingCase[]
}

/**
 * The desktop's (grid_pos, grid_basis) pair as the single 4×4 the web works
 * in: translation × the row-major 3×3 the dump wrote.
 */
function basisMatrix(c: HitCase): THREE.Matrix4 {
  const b = c.grid_basis
  return new THREE.Matrix4().set(
    b[0][0], b[0][1], b[0][2], c.grid_pos[0],
    b[1][0], b[1][1], b[1][2], c.grid_pos[1],
    b[2][0], b[2][1], b[2][2], c.grid_pos[2],
    0, 0, 0, 1,
  )
}

function toNode(row: StampRow): GvNode {
  const node = blankNode(row.id, NEW_OBJECT_DEFAULTS)
  node.parentId = row.parent_id
  node.branchLevel = row.branch_level
  node.translate = { x: row.translate_x, y: row.translate_y, z: row.translate_z }
  node.rotate = { x: row.rotate_x, y: row.rotate_y, z: row.rotate_z }
  node.scale = { x: row.scale_x, y: row.scale_y, z: row.scale_z }
  return node
}

describe('draw mode parity: grid_hit', () => {
  it('covers every dumped case', () => {
    expect(fixture.grid_hits.length).toBeGreaterThanOrEqual(9)
  })

  for (const c of fixture.grid_hits) {
    it(`matches the desktop for ${c.name}`, () => {
      const ray = new THREE.Ray(
        new THREE.Vector3(...c.ray_origin),
        new THREE.Vector3(...c.ray_direction),
      )
      const hit = gridHitInBasis(ray, basisMatrix(c), { lon: c.grid_center[0], lat: c.grid_center[1] }, c.draw_z)
      if (c.hit === null) {
        expect(hit).toBeNull()
        return
      }
      expect(hit).not.toBeNull()
      // Both sides invert a 4×4 in float64; 1e-9 is the same tolerance the
      // world-transform harness uses for placement.
      expect(hit!.lon).toBeCloseTo(c.hit[0], 9)
      expect(hit!.lat).toBeCloseTo(c.hit[1], 9)
    })
  }
})

describe('draw mode parity: place_stamp', () => {
  for (const c of fixture.stamps) {
    it(`matches the desktop for ${c.name}`, () => {
      const rng = new PythonRandom(c.seed)
      const nodes = c.nodes_in.map(toNode)
      const jitter = placeStamp(
        nodes,
        c.base_branch_level,
        c.lon,
        c.lat,
        c.z,
        c.heading_jitter,
        c.scale_jitter,
        rng,
      )
      expect(jitter.heading).toBeCloseTo(c.heading, 12)
      expect(jitter.factor).toBeCloseTo(c.factor, 12)
      // The stream must be exactly as far along as the desktop's — this is
      // what pins the "no draw when the jitter is 0" short-circuit.
      expect(rng.random()).toBeCloseTo(c.next_draw, 15)

      expect(nodes.length).toBe(c.nodes_out.length)
      for (let i = 0; i < nodes.length; i++) {
        const got = nodes[i]
        const want = c.nodes_out[i]
        expect(got.id).toBe(want.id)
        expect(got.branchLevel).toBe(want.branch_level)
        expect(got.translate.x).toBeCloseTo(want.translate_x, 12)
        expect(got.translate.y).toBeCloseTo(want.translate_y, 12)
        expect(got.translate.z).toBeCloseTo(want.translate_z, 12)
        expect(got.rotate.x).toBeCloseTo(want.rotate_x, 12)
        expect(got.rotate.y).toBeCloseTo(want.rotate_y, 12)
        expect(got.rotate.z).toBeCloseTo(want.rotate_z, 12)
        expect(got.scale.x).toBeCloseTo(want.scale_x, 12)
        expect(got.scale.y).toBeCloseTo(want.scale_y, 12)
        expect(got.scale.z).toBeCloseTo(want.scale_z, 12)
      }
    })
  }
})

describe('draw mode parity: should_stamp', () => {
  it('gates a stroke exactly as the desktop does', () => {
    for (const c of fixture.spacing) {
      expect(
        shouldStamp(c.last === null ? null : { x: c.last[0], y: c.last[1] }, c.x, c.y, c.spacing),
        `last=${JSON.stringify(c.last)} → (${c.x}, ${c.y}) @ ${c.spacing}`,
      ).toBe(c.stamp)
    }
  })
})
